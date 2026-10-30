#!/usr/bin/env bash
# Builds EY ECHO flow folders into runnable Spring Boot apps and container images.
#
#   pipeline/build-flow.sh <folder>... [options]
#
# Each <folder> is a flow folder (flows/orders) or a folder of flows (flows/). templates/ is never built,
# nor is a flow switched off in the Builder ("disabled": true in its echo-flow.json).
#
# Options (or environment variables):
#   --mode <m>         bundle: all the flows in one image (default); per-flow: one image per flow (BUILD_MODE)
#   --name <n>         bundle image and app name               (BUNDLE_NAME, default: echo-flows)
#   --version <v>      image tag and Maven version            (FLOW_VERSION; per-flow default: echo-flow.json
#                      version or 1.0.0; bundle default: 1.0.0)
#   --registry <url>   push to <url>/<image>:<v>               (REGISTRY_URL; needs registry login or
#                      REGISTRY_USERNAME / REGISTRY_PASSWORD)
#   --local-image      build into the local Docker daemon instead of pushing
#   --jar-only         stop after "mvn package"
#   --manifests-only   only check the flows and write the Kubernetes manifests (no export, jar or image)
#   --out <dir>        working folder; each app goes in <dir>/<name> (default: build)
#   --k8s-config <f>   settings of the Kubernetes manifests (K8S_CONFIG, default: pipeline/k8s.properties)
#   --env-values <f>   values of the flows' {{placeholders}} for one environment, a .properties file kept
#                      outside the flow repository (ENV_VALUES; e.g. inventory.host=inventory.prod.local)
#
# Next to each image, <dir>/<app>/k8s/ gets a Deployment, a Service and an Ingress (or Gateway API
# HTTPRoute) for only the paths the app's flows serve, made by K8sManifests.java; see k8s.properties.
# The {{placeholders}} the flows use go in configmap.yaml (ConfigMap <app>-env, values from --env-values
# or the flow's application.properties); sensitive ones (k8s.secret-names) are listed in
# secret.yaml.example for you to create the Secret <app>-env: the build never writes secret values.
#
# Images: bundle -> <name>:<v> (echo-flows); per-flow -> echo-flow-<flow>:<v>. Bundled flows share one
# port, so their Base Paths (and other app-wide names) must differ: BundleCheck.java fails the build
# and lists the clashes; a bundle also serves Swagger UI for all its flows at /api-docs. Steps: camel
# export --runtime=spring-boot -> mvn package -> Jib image (no Docker daemon needed to push). Nothing
# here is tied to a CI product; Jenkinsfile calls it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="${ECHO_RUNTIME_TEMPLATE:-$HERE/../runtime-template}"

usage() { sed -n '2,34p' "$0"; exit "${1:-0}"; }

FOLDERS=()
BUILD_MODE="${BUILD_MODE:-bundle}"
BUNDLE_NAME="${BUNDLE_NAME:-echo-flows}"
VERSION="${FLOW_VERSION:-}"
REGISTRY="${REGISTRY_URL:-}"
MODE="push"
OUT_ROOT="$PWD/build"
K8S_CONFIG="${K8S_CONFIG:-$HERE/k8s.properties}"
ENV_VALUES="${ENV_VALUES:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) BUILD_MODE="$2"; shift 2 ;;
    --name) BUNDLE_NAME="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --local-image) MODE="local"; shift ;;
    --jar-only) MODE="jar"; shift ;;
    --manifests-only) MODE="manifests"; shift ;;
    --k8s-config) K8S_CONFIG="$2"; shift 2 ;;
    --env-values) ENV_VALUES="$2"; shift 2 ;;
    --out) OUT_ROOT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    -*) echo "Unknown option $1" >&2; usage 1 ;;
    *) FOLDERS+=("$1"); shift ;;
  esac
done
[[ "$BUILD_MODE" == bundle || "$BUILD_MODE" == per-flow ]] || { echo "--mode must be bundle or per-flow" >&2; exit 1; }
[[ ${#FOLDERS[@]} -gt 0 ]] || { echo "No flow folder given" >&2; usage 1; }
if [[ "$MODE" == "push" && -z "$REGISTRY" ]]; then
  echo "No registry given: use --registry, --local-image or --jar-only" >&2; exit 1
fi
if [[ -n "$ENV_VALUES" ]]; then
  [[ -f "$ENV_VALUES" ]] || { echo "Values file not found: $ENV_VALUES" >&2; exit 1; }
  ENV_VALUES="$(cd "$(dirname "$ENV_VALUES")" && pwd)/$(basename "$ENV_VALUES")"
fi
mkdir -p "$OUT_ROOT" && OUT_ROOT="$(cd "$OUT_ROOT" && pwd)"

# The flow folders to build: a folder with <name>.camel.yaml is a flow, any other folder holds flows.
FLOWS=()
add_flow() {
  local dir; dir="$(cd "$1" && pwd)"
  # Templates (saved with the Builder's Save As Template) are starting points, not deployable flows.
  if [[ "$(basename "$(dirname "$dir")")" == "templates" ]]; then
    echo "Skipping $dir: templates are not built into images." >&2; return
  fi
  [[ -f "$dir/$(basename "$dir").camel.yaml" ]] || { echo "Missing $(basename "$dir").camel.yaml in $dir" >&2; exit 1; }
  # Disabled on the Builder's Open Flow page: kept in Git, left out of images until it is enabled again.
  if [[ -f "$dir/echo-flow.json" ]] && grep -qE '"disabled"[[:space:]]*:[[:space:]]*true' "$dir/echo-flow.json"; then
    echo "Skipping $dir: the flow is disabled." >&2; return
  fi
  FLOWS+=("$dir")
}
for folder in "${FOLDERS[@]}"; do
  [[ -d "$folder" ]] || { echo "Flow folder not found: $folder" >&2; exit 1; }
  dir="$(cd "$folder" && pwd)"
  if [[ -f "$dir/$(basename "$dir").camel.yaml" || "$(basename "$(dirname "$dir")")" == templates ]]; then
    add_flow "$dir"
  else
    for sub in "$dir"/*/; do
      if [[ -f "$sub/$(basename "$sub").camel.yaml" ]]; then add_flow "$sub"; fi
    done
  fi
done
[[ ${#FLOWS[@]} -gt 0 ]] || { echo "No flows to build." >&2; exit 0; }

prop() { grep -E "^$1=" "$TEMPLATE/versions.properties" | cut -d= -f2-; }
CAMEL_VERSION="$(prop camel.version)"
QUARKUS_VERSION="$(prop quarkus.version)"
JIB_VERSION="$(prop jib.version)"
SWAGGER_UI_VERSION="$(prop swagger-ui.version)"
BASE_IMAGE="$(prop base.image)"

# Camel JBang: the launcher jar of the pinned version (downloaded once). The launcher jar fixes the
# Camel version; CAMEL_CMD may point at another Camel CLI of the same version.
LAUNCHER="${CAMEL_LAUNCHER_JAR:-$HOME/.echo/camel-launcher-$CAMEL_VERSION.jar}"
launcher() {
  if [[ ! -f "$LAUNCHER" ]]; then
    mkdir -p "$(dirname "$LAUNCHER")"
    echo "Downloading Camel launcher $CAMEL_VERSION" >&2
    curl -fsSL -o "$LAUNCHER.tmp" \
      "${MAVEN_REPO_URL:-https://repo.maven.apache.org/maven2}/org/apache/camel/camel-launcher/$CAMEL_VERSION/camel-launcher-$CAMEL_VERSION.jar"
    mv "$LAUNCHER.tmp" "$LAUNCHER"
  fi
}
camel() {
  if [[ -n "${CAMEL_CMD:-}" ]]; then $CAMEL_CMD "$@"; return; fi
  launcher
  java -jar "$LAUNCHER" "$@"
}

# Copies what the runtime needs from one flow folder into <src>: routes, DataMapper XSLT, OpenAPI
# specs (JSON or YAML) and JSON schemas (rest-openapi reads specs from the classpath).
copy_flow() { # flow-dir, src, rest-id-suffix
  local dir="$1" src="$2" suffix="$3" f
  shopt -s nullglob
  cp "$dir"/*.camel.yaml "$src/"
  for f in "$dir"/*.xsl; do cp "$f" "$src/"; done
  for f in "$dir"/*.json; do [[ "$(basename "$f")" == echo-flow.json ]] || cp "$f" "$src/"; done
  # The flow's OpenAPI spec may be YAML (Openapi Design keeps JSON or YAML); export puts it on the classpath.
  for f in "$dir"/*.yaml "$dir"/*.yml; do
    [[ "$f" == *.camel.yaml ]] || ! grep -qE '^(openapi|swagger):' "$f" || cp "$f" "$src/"
  done
  # Every flow's generated REST service is called echo-openapi; in a bundle each needs its own id.
  if [[ -n "$suffix" ]]; then
    sed -i.bak -E "s/^([[:space:]]*id: )'?echo-openapi'?[[:space:]]*$/\1echo-openapi-$suffix/" "$src/$(basename "$dir").camel.yaml"
    rm -f "$src/$(basename "$dir").camel.yaml.bak"
  fi
}

# Exports <src> as app <name> and builds the jar and image; the image name goes in <out>/image.txt.
build_app() { # name, version, out, image-name
  local name="$1" version="$2" out="$3" image_name="$4" src="$3/src-flow" app="$3/app" jar image
  sed -i.bak "s/\${ECHO_FLOW_NAME:echo-flow}/$name/" "$src/application.properties" && rm -f "$src/application.properties.bak"
  # Swagger UI at <Base Path>/docs (the routes RestFromSpec adds read it from this webjar).
  printf '\n# Swagger UI webjar (build-flow.sh)\necho.swagger-ui.version=%s\n' "$SWAGGER_UI_VERSION" >> "$src/application.properties"

  echo "==> Exporting $name $version (Camel $CAMEL_VERSION, Spring Boot runtime)"
  # Export finds components from the routes; these it cannot see: the validator that checks
  # request bodies against the spec (Client Request Validation), Swagger UI, and the http component
  # and platform-http the HTTP log is written against.
  (cd "$src" && camel export ./* --runtime=spring-boot \
    --dep="camel:openapi-validator,org.webjars:swagger-ui:$SWAGGER_UI_VERSION,camel:http,camel:platform-http" \
    --quarkus-version="$QUARKUS_VERSION" --gav="com.ey.echo.flows:$name:$version" --directory="$app")

  # EY ECHO's HTTP log (requests in and out, echo.http-log.* settings) goes in every app, as source
  # (given to export, Camel JBang would compile it as routes).
  mkdir -p "$app/src/main/java/com/ey/echo/runtime"
  cp "$TEMPLATE"/java/com/ey/echo/runtime/*.java "$app/src/main/java/com/ey/echo/runtime/"
  # Outside the app's package, so Spring Boot finds it as an auto-configuration.
  mkdir -p "$app/src/main/resources/META-INF/spring"
  echo com.ey.echo.runtime.HttpExchangeLogConfiguration \
    >> "$app/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports"

  echo "==> Building the app"
  (cd "$app" && mvn -B -q package -DskipTests)
  jar="$(ls "$app"/target/"$name"-"$version".jar)"
  echo "Built $jar"
  [[ "$MODE" == "jar" ]] && return 0

  local jib="com.google.cloud.tools:jib-maven-plugin:$JIB_VERSION"
  local jib_args=(-B -q "-Djib.from.image=$BASE_IMAGE" "-Djib.container.ports=8080"
    "-Djib.container.labels=org.opencontainers.image.title=$image_name,org.opencontainers.image.version=$version")
  if [[ "$MODE" == "local" ]]; then
    image="$image_name:$version"
    echo "==> Building local image $image"
    (cd "$app" && mvn "${jib_args[@]}" "$jib:dockerBuild" -Dimage="$image")
  else
    image="${REGISTRY%/}/$image_name:$version"
    echo "==> Pushing $image"
    local auth=()
    [[ -n "${REGISTRY_USERNAME:-}" ]] && auth=("-Djib.to.auth.username=$REGISTRY_USERNAME" "-Djib.to.auth.password=$REGISTRY_PASSWORD")
    (cd "$app" && mvn "${jib_args[@]}" "${auth[@]}" "$jib:build" -Dimage="$image")
  fi
  echo "$image" > "$out/image.txt"
  echo "Image: $image"
}

# The pipeline's Java helpers read YAML with the SnakeYAML jar inside the Camel launcher, so they need no
# download. Sets YAML_JAR.
yaml_jar() {
  local check="$OUT_ROOT/.yaml" entry
  launcher
  entry="$(jar tf "$LAUNCHER" | grep -E '^BOOT-INF/lib/snakeyaml-[0-9.]+\.jar$' | head -1)"
  [[ -f "$check/$entry" ]] || { mkdir -p "$check" && (cd "$check" && jar xf "$LAUNCHER" "$entry"); }
  YAML_JAR="$check/$entry"
}

# The image reference build_app gives the app (the registry only when it pushes or is given).
image_ref() { # image-name, version
  if [[ -n "$REGISTRY" && "$MODE" != local ]]; then echo "${REGISTRY%/}/$1:$2"; else echo "$1:$2"; fi
}

# Kubernetes manifests for the app in <out>/k8s: Deployment, Service, an Ingress or HTTPRoute for
# only the paths its flows serve, and the ConfigMap (and Secret example) of its {{placeholders}}.
k8s_manifests() { # image-name, version, out, [--api-docs], flow-dir...
  local name="$1" image; image="$(image_ref "$1" "$2")"; local out="$3"; shift 3
  local values=(); [[ -n "$ENV_VALUES" ]] && values=(--values "$ENV_VALUES")
  java -cp "$YAML_JAR" "$HERE/K8sManifests.java" "$K8S_CONFIG" "$name" "$image" "$out" "${values[@]}" "$@"
}

flow_props() { # flow-dir
  [[ -f "$1/application.properties" ]] || return 0
  echo; echo "# --- flow $(basename "$1") ---"; cat "$1/application.properties"
}

yaml_jar
if [[ "$BUILD_MODE" == per-flow ]]; then
  for dir in "${FLOWS[@]}"; do
    name="$(basename "$dir")"
    version="$VERSION"
    if [[ -z "$version" && -f "$dir/echo-flow.json" ]]; then
      version="$(sed -n 's/.*"version" *: *\([0-9][0-9]*\).*/\1/p' "$dir/echo-flow.json" | head -1)"
      [[ -n "$version" ]] && version="1.0.$version"
    fi
    out="$OUT_ROOT/$name"
    rm -rf "$out" && mkdir -p "$out/src-flow"
    copy_flow "$dir" "$out/src-flow" ""
    # Properties: template first, flow last.
    { cat "$TEMPLATE/application.properties"; flow_props "$dir"; } > "$out/src-flow/application.properties"
    k8s_manifests "echo-flow-$name" "${version:-1.0.0}" "$out" "$dir"
    [[ "$MODE" == manifests ]] || build_app "$name" "${version:-1.0.0}" "$out" "echo-flow-$name"
  done
  exit 0
fi

# Bundle: every flow in one app. They share one port, so check first that nothing clashes.
names=(); for dir in "${FLOWS[@]}"; do names+=("$(basename "$dir")"); done
echo "==> Bundling ${#FLOWS[@]} flow(s) into $BUNDLE_NAME: ${names[*]}"
out="$OUT_ROOT/$BUNDLE_NAME"
rm -rf "$out" && mkdir -p "$out/src-flow"
java -cp "$YAML_JAR" "$HERE/BundleCheck.java" "${FLOWS[@]}"
{ cat "$TEMPLATE/application.properties"
  for dir in "${FLOWS[@]}"; do flow_props "$dir"; done; } > "$out/src-flow/application.properties"
for dir in "${FLOWS[@]}"; do copy_flow "$dir" "$out/src-flow" "$(basename "$dir")"; done
# One Swagger UI page at /api-docs for all the flows: a drop-down picks the flow (A to Z, ignoring case).
java -cp "$YAML_JAR" "$HERE/ApiDocsPage.java" "$out/src-flow/echo-api-docs.camel.yaml" "${FLOWS[@]}"
api_docs=(); [[ -f "$out/src-flow/echo-api-docs.camel.yaml" ]] && api_docs=(--api-docs)
k8s_manifests "$BUNDLE_NAME" "${VERSION:-1.0.0}" "$out" "${api_docs[@]}" "${FLOWS[@]}"
[[ "$MODE" == manifests ]] || build_app "$BUNDLE_NAME" "${VERSION:-1.0.0}" "$out" "$BUNDLE_NAME"
