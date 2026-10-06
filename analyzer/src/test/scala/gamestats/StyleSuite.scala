package gamestats

import java.nio.file.{Files, Path, Paths}
import scala.jdk.CollectionConverters.*

/** The analysis package is the part that shows the functional paradigm: this suite fails the build
  * if it uses mutable state, null or effects. Comments are skipped, so they may talk about these
  * words freely.
  */
class StyleSuite extends munit.FunSuite:

  val root: Path = Paths.get("src/main/scala/gamestats/analysis")

  /** (file, line number, code without comments) of every analysis source. */
  val lines: List[(Path, Int, String)] =
    Files
      .walk(root)
      .iterator()
      .asScala
      .filter(_.toString.endsWith(".scala"))
      .toList
      .flatMap { file =>
        Files.readAllLines(file).asScala.toList.zipWithIndex.map((l, i) => (file, i + 1, l))
      }
      .map((f, n, l) => (f, n, l.replaceAll("//.*$", "")))
      .filterNot((_, _, l) => l.trim.startsWith("*") || l.trim.startsWith("/*"))

  val rules: List[(String, scala.util.matching.Regex)] = List(
    "var" -> raw"\bvar\b".r,
    "mutable collections" -> raw"collection\.mutable".r,
    "null" -> raw"\bnull\b".r,
    "effects (cats.effect)" -> raw"cats\.effect".r,
    "file or console I/O" -> raw"java\.(io|nio)|println".r
  )

  test("analysis/ has Scala sources to check") {
    assert(lines.size > 300, s"only ${lines.size} lines found under $root")
  }

  for (name, pattern) <- rules do
    test(s"analysis/ uses no $name") {
      val offenders = lines.collect {
        case (f, n, l) if pattern.findFirstIn(l).isDefined => s"$f:$n: ${l.trim}"
      }
      assert(offenders.isEmpty, offenders.mkString("\n"))
    }
