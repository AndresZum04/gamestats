val http4sVersion = "0.23.30"
val circeVersion  = "0.14.10"

lazy val root = (project in file("."))
  .settings(
    name         := "analyzer",
    organization := "gamestats",
    version      := "0.1.0",
    scalaVersion := "3.3.4",
    scalacOptions ++= Seq("-deprecation", "-feature", "-unchecked", "-Wunused:all"),
    libraryDependencies ++= Seq(
      "org.http4s"    %% "http4s-ember-server" % http4sVersion,
      "org.http4s"    %% "http4s-ember-client" % http4sVersion,
      "org.http4s"    %% "http4s-dsl"          % http4sVersion,
      "org.http4s"    %% "http4s-circe"        % http4sVersion,
      "io.circe"      %% "circe-generic"       % circeVersion,
      "io.circe"      %% "circe-parser"        % circeVersion,
      "ch.qos.logback" % "logback-classic"     % "1.5.12",
      "org.scalameta" %% "munit"               % "1.0.2" % Test
    ),
    // La configuración de formato vive en la raíz del monorepo.
    scalafmtConfig := file("../.scalafmt.conf"),
    Compile / mainClass       := Some("gamestats.Main"),
    assembly / mainClass      := Some("gamestats.Main"),
    assembly / assemblyJarName := "analyzer.jar",
    assembly / assemblyMergeStrategy := {
      case PathList("META-INF", "versions", _*)              => MergeStrategy.first
      case PathList("META-INF", "MANIFEST.MF")               => MergeStrategy.discard
      case PathList("META-INF", xs @ _*) if xs.lastOption.exists(_.endsWith(".SF")) =>
        MergeStrategy.discard
      case "module-info.class"                               => MergeStrategy.discard
      case x =>
        val old = (assembly / assemblyMergeStrategy).value
        old(x)
    }
  )
