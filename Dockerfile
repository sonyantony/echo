# EY ECHO Builder: one image with the backend serving the built UI.
#   docker build -t echo-builder .
#   docker compose up        (see docker-compose.yml)

FROM node:22-bookworm-slim AS ui
WORKDIR /src/builder-ui
RUN corepack enable
COPY builder-ui/package.json builder-ui/pnpm-lock.yaml ./
COPY builder-ui/scripts ./scripts
RUN pnpm install --frozen-lockfile
COPY builder-ui/ ./
# The playground imports the golden sample flow.
COPY samples/ /src/samples/
RUN pnpm build

FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /src/builder-backend
COPY builder-backend/pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY builder-backend/src ./src
COPY --from=ui /src/builder-ui/dist /src/builder-ui/dist
RUN mvn -B -q -Pwith-ui package -DskipTests

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 --home-dir /data echo \
 && mkdir -p /data /config && chown echo /data
COPY --from=backend /src/builder-backend/target/echo-builder-backend-*.jar /app/echo-builder.jar
USER echo
ENV ECHO_DATA_DIR=/data
# Logo, favicon and other branding files for this install (see docs/branding.md).
ENV ECHO_BRANDING_DIR=/config/branding
VOLUME /data
EXPOSE 8080 8081-8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -fsS http://localhost:8080/actuator/health || exit 1
# application.yaml in /config (mounted) overrides the built-in defaults.
ENTRYPOINT ["java", "-jar", "/app/echo-builder.jar", "--spring.config.additional-location=optional:file:/config/"]
