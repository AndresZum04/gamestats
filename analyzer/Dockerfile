# Analyzer (Scala). Compila con sbt dentro de la imagen y deja solo el jar
# sobre un JRE.  docker build -f analyzer/Dockerfile .
FROM sbtscala/scala-sbt:eclipse-temurin-21.0.12_8_1.13.0_3.3.8 AS build
WORKDIR /src/analyzer
# Primero la definición del build: descargar dependencias es lo que más
# tarda, y esta capa se reutiliza mientras build.sbt no cambie.
COPY .scalafmt.conf /src/.scalafmt.conf
COPY analyzer/project/build.properties analyzer/project/plugins.sbt ./project/
COPY analyzer/build.sbt ./
RUN sbt -batch update
COPY analyzer/src ./src
RUN sbt -batch assembly && cp target/scala-*/analyzer.jar /analyzer.jar

FROM eclipse-temurin:21-jre-alpine
RUN adduser -D -H -u 10001 gamestats
COPY --from=build /analyzer.jar /app/analyzer.jar
ENV PORT=8081 RESULTS_DIR=/data/results \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC"
USER gamestats
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "/app/analyzer.jar"]
