#!/usr/bin/env bash
# Builds one ECHO flow folder into a runnable Spring Boot app and container image.
#
#   pipeline/build-flow.sh <flow-folder> [options]
#
# Options (or environment variables):
#   --version <v>      image tag and Maven version            (FLOW_VERSION, default: echo-flow.json version or 1.0.0)
#   --registry <url>   push to <url>/echo-flow-<name>:<v>      (REGISTRY_URL; needs registry login or
#                      REGISTRY_USERNAME / REGISTRY_PASSWORD)
#   --local-image      build into the local Docker daemon instead of pushing
#   --jar-only         stop after "mvn package"
#   --out <dir>        working folder                         (default: build/<name>)
#
# Steps: camel export --runtime=spring-boot -> mvn package -> Jib image. Jib needs no Docker
# daemon to push to a registry. Nothing here is tied to a CI product; Jenkinsfile calls it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="${ECHO_RUNTIME_TEMPLATE:-$HERE/../runtime-template}"

usage() { sed -n '2,16p' "$0"; exit "${1:-0}"; }

FLOW_DIR=""
VERSION="${FLOW_VERSION:-}"
REGISTRY="${REGISTRY_URL:-}"
MODE="push"
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --local-image) MODE="local"; shift ;;
    --jar-only) MODE="jar"; shift ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    -*) echo "Unknown option $1" >&2; usage 1 ;;
    *) FLOW_DIR="$1"; shift ;;
  esac
done
[[ -n "$FLOW_DIR" && -d "$FLOW_DIR" ]] || { echo "Flow folder not found: $FLOW_DIR" >&2; usage 1; }
FLOW_DIR="$(cd "$FLOW_DIR" && pwd)"
NAME="$(basename "$FLOW_DIR")"
[[ -f "$FLOW_DIR/$NAME.camel.yaml" ]] || { echo "Missing $NAME.camel.yaml in $FLOW_DIR" >&2; exit 1; }
if [[ "$MODE" == "push" && -z "$REGISTRY" ]]; then
  echo "No registry given: use --registry, --local-image or --jar-only" >&2; exit 1
fi

prop() { grep -E "^$1=" "$TEMPLATE/versions.properties" | cut -d= -f2-; }
CAMEL_VERSION="$(prop camel.version)"
QUARKUS_VERSION="$(prop quarkus.version)"
JIB_VERSION="$(prop jib.version)"
BASE_IMAGE="$(prop base.image)"

if [[ -z "$VERSION" && -f "$FLOW_DIR/echo-flow.json" ]]; then
  VERSION="$(sed -n 's/.*"version" *: *\([0-9][0-9]*\).*/\1/p' "$FLOW_DIR/echo-flow.json" | head -1)"
  [[ -n "$VERSION" ]] && VERSION="1.0.$VERSION"
fi
VERSION="${VERSION:-1.0.0}"

# Camel JBang: the launcher jar of the pinned version (downloaded once). The launcher jar fixes the
# Camel version; CAMEL_CMD may point at another Camel CLI of the same version.
camel() {
  if [[ -n "${CAMEL_CMD:-}" ]]; then $CAMEL_CMD "$@"; return; fi
  local jar="${CAMEL_LAUNCHER_JAR:-$HOME/.echo/camel-launcher-$CAMEL_VERSION.jar}"
  if [[ ! -f "$jar" ]]; then
    mkdir -p "$(dirname "$jar")"
    echo "Downloading Camel launcher $CAMEL_VERSION" >&2
    curl -fsSL -o "$jar.tmp" \
      "${MAVEN_REPO_URL:-https://repo.maven.apache.org/maven2}/org/apache/camel/camel-launcher/$CAMEL_VERSION/camel-launcher-$CAMEL_VERSION.jar"
    mv "$jar.tmp" "$jar"
  fi
  java -jar "$jar" "$@"
}

OUT="${OUT:-$PWD/build/$NAME}"
SRC="$OUT/src-flow"
APP="$OUT/app"
rm -rf "$OUT" && mkdir -p "$SRC"

# Only what the runtime needs: routes, DataMapper XSLT and properties (template first, flow last).
shopt -s nullglob
cp "$FLOW_DIR"/*.camel.yaml "$SRC/"
for f in "$FLOW_DIR"/*.xsl; do cp "$f" "$SRC/"; done
{ cat "$TEMPLATE/application.properties"; echo; echo "# --- flow $NAME ---";
  [[ -f "$FLOW_DIR/application.properties" ]] && cat "$FLOW_DIR/application.properties"; } > "$SRC/application.properties"
sed -i.bak "s/\${ECHO_FLOW_NAME:echo-flow}/$NAME/" "$SRC/application.properties" && rm -f "$SRC/application.properties.bak"

echo "==> Exporting $NAME $VERSION (Camel $CAMEL_VERSION, Spring Boot runtime)"
(cd "$SRC" && camel export ./* --runtime=spring-boot \
  --quarkus-version="$QUARKUS_VERSION" --gav="com.ey.echo.flows:$NAME:$VERSION" --directory="$APP")

echo "==> Building the app"
(cd "$APP" && mvn -B -q package -DskipTests)
JAR="$(ls "$APP"/target/"$NAME"-"$VERSION".jar)"
echo "Built $JAR"
[[ "$MODE" == "jar" ]] && exit 0

JIB="com.google.cloud.tools:jib-maven-plugin:$JIB_VERSION"
JIB_ARGS=(-B -q "-Djib.from.image=$BASE_IMAGE" "-Djib.container.ports=8080"
  "-Djib.container.labels=org.opencontainers.image.title=echo-flow-$NAME,org.opencontainers.image.version=$VERSION")
if [[ "$MODE" == "local" ]]; then
  IMAGE="echo-flow-$NAME:$VERSION"
  echo "==> Building local image $IMAGE"
  (cd "$APP" && mvn "${JIB_ARGS[@]}" "$JIB:dockerBuild" -Dimage="$IMAGE")
else
  IMAGE="${REGISTRY%/}/echo-flow-$NAME:$VERSION"
  echo "==> Pushing $IMAGE"
  AUTH=()
  [[ -n "${REGISTRY_USERNAME:-}" ]] && AUTH=("-Djib.to.auth.username=$REGISTRY_USERNAME" "-Djib.to.auth.password=$REGISTRY_PASSWORD")
  (cd "$APP" && mvn "${JIB_ARGS[@]}" "${AUTH[@]}" "$JIB:build" -Dimage="$IMAGE")
fi
echo "$IMAGE" > "$OUT/image.txt"
echo "Image: $IMAGE"
