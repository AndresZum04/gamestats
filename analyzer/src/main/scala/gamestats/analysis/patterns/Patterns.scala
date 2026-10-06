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

  /** Seconds with one decimal, for descriptions: 8000 -> "8", 8500 -> "8,5". */
  def seconds(ms: Long): String =
    val s = BigDecimal(ms) / 1000
    (if s.isWhole then s.toBigInt.toString
     else s.setScale(1, BigDecimal.RoundingMode.HALF_UP).toString).replace('.', ',')
