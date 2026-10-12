package gamestats.analysis.patterns

import gamestats.analysis.MatchContext
import gamestats.model.{CommonEvent, PatternMatch}

/** Helpers shared by the detectors. */
object Patterns:

  def make[E](
      ctx: MatchContext[E],
      patternId: String,
      name: String,
      playerId: Option[String],
      teamId: Option[String],
      atMs: Long,
      description: String,
      evidence: List[String]
  ): PatternMatch =
    PatternMatch(
      patternId,
      name,
      ctx.batch.gameId,
      ctx.batch.matchId,
      playerId,
      teamId,
      atMs,
      description,
      evidence
    )

  /** MATCH_FINISHED of a COMPLETE match. */
  def finished[E](ctx: MatchContext[E]): Option[CommonEvent.MatchFinished] =
    if ctx.batch.partial then None
    else ctx.common.collectFirst { case f: CommonEvent.MatchFinished => f }

  /** Maximal runs of consecutive items that satisfy keep, in order. A foldLeft carries the run in
    * progress (reversed) and the runs already closed; an item that fails keep closes the run.
    * runs(List(1, 2, -1, 3))(_ > 0) == List(List(1, 2), List(3)).
    */
  def runs[A](items: List[A])(keep: A => Boolean): List[List[A]] =
    val (current, closed) = items.foldLeft((List.empty[A], List.empty[List[A]])) {
      case ((cur, done), a) if keep(a) => (a :: cur, done)
      case ((Nil, done), _)            => (Nil, done)
      case ((cur, done), _)            => (Nil, cur.reverse :: done)
    }
    (if current.isEmpty then closed else current.reverse :: closed).reverse

  /** Seconds with one decimal, for descriptions: 8000 -> "8", 8500 -> "8,5". */
  def seconds(ms: Long): String =
    val s = BigDecimal(ms) / 1000
    (if s.isWhole then s.toBigInt.toString
     else s.setScale(1, BigDecimal.RoundingMode.HALF_UP).toString).replace('.', ',')
