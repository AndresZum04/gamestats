import { describe, expect, it } from "vitest";
import { Rng } from "../../../src/core/Rng.js";
import { BlackjackTable } from "../../../src/games/blackjack/BlackjackTable.js";
import { Card } from "../../../src/games/blackjack/Card.js";
import { BasicStrategy } from "../../../src/games/blackjack/DecisionStrategy.js";
import { Dealer } from "../../../src/games/blackjack/Dealer.js";
import { Hand } from "../../../src/games/blackjack/Hand.js";
import { Shoe } from "../../../src/games/blackjack/Shoe.js";

const hand = (...codes: string[]) => {
  const h = new Hand();
  for (const c of codes) h.add(Card.parse(c));
  return h;
};

describe("Card", () => {
  it("uses the GameStats codes and values", () => {
    expect(Card.parse("10H").code).toBe("10H");
    expect(Card.parse("KS").points).toBe(10);
    expect(Card.parse("KS").valueKey).toBe("10");
    expect(Card.parse("AD").points).toBe(11);
    expect(Card.parse("7C").label).toBe("7♣");
    expect(() => Card.parse("1X")).toThrow(/bad card/);
  });
});

describe("Hand", () => {
  it("counts soft aces and lowers them when needed", () => {
    expect(hand("AS", "6H").value).toBe(17);
    expect(hand("AS", "6H").soft).toBe(true);
    expect(hand("AS", "6H", "9D").value).toBe(16);
    expect(hand("AS", "6H", "9D").soft).toBe(false);
    expect(hand("AS", "AH").value).toBe(12);
    expect(hand("AS", "AH", "AD", "8C").value).toBe(21);
  });

  it("blackjack only with the first two cards; bust over 21", () => {
    expect(hand("AS", "KH").blackjack).toBe(true);
    expect(hand("7S", "4H", "QD").blackjack).toBe(false);
    expect(hand("7S", "4H", "QD").value).toBe(21);
    expect(hand("KS", "QH", "2D").bust).toBe(true);
    expect(hand("KS", "QH").bust).toBe(false);
  });
});

describe("Shoe", () => {
  it("has 6 decks, knows what is left and is rebuilt under 25 %", () => {
    const shoe = new Shoe(new Rng(1));
    expect(shoe.remaining).toBe(312);
    expect(shoe.composition()).toEqual({
      A: 24,
      "2": 24,
      "3": 24,
      "4": 24,
      "5": 24,
      "6": 24,
      "7": 24,
      "8": 24,
      "9": 24,
      "10": 96,
    });
    const drawn = Array.from({ length: 235 }, () => shoe.draw());
    const comp = shoe.composition();
    expect(Object.values(comp).reduce((a, b) => a + b, 0)).toBe(77);
    expect(comp.A).toBe(24 - drawn.filter((c) => c.rank === "A").length);
  });

  it("asks for a new shuffle when less than 25 % is left", () => {
    const shoe = new Shoe(new Rng(1));
    for (let i = 0; i < 234; i++) shoe.draw();
    expect(shoe.remaining).toBe(78); // exactly 25 %
    expect(shoe.needsShuffle).toBe(false);
    shoe.draw();
    expect(shoe.needsShuffle).toBe(true);
    shoe.shuffle();
    expect(shoe.remaining).toBe(312);
    expect(shoe.shuffles).toBe(2);
  });

  it("the same seed deals the same cards", () => {
    const deal = () => {
      const shoe = new Shoe(new Rng(9));
      return Array.from({ length: 10 }, () => shoe.draw().code);
    };
    expect(deal()).toEqual(deal());
  });
});

describe("Dealer", () => {
  it("hits under 17 and stands on soft 17", () => {
    const d = new Dealer();
    d.take(Card.parse("10S"));
    d.take(Card.parse("6H"));
    expect(d.mustHit).toBe(true);
    d.newRound();
    d.take(Card.parse("AS"));
    d.take(Card.parse("6H"));
    expect(d.mustHit).toBe(false);
    expect(d.upcard?.code).toBe("AS");
    expect(d.revealed).toBe(false);
  });
});

describe("BlackjackTable.settle (payouts)", () => {
  const settle = BlackjackTable.settle;
  it("a blackjack pays 3:2, or pushes against the house's blackjack", () => {
    expect(settle(hand("AS", "KH"), 100, hand("10S", "9H"))).toEqual({
      result: "WIN",
      payout: 150,
    });
    expect(settle(hand("AS", "KH"), 100, hand("AD", "QC"))).toEqual({ result: "PUSH", payout: 0 });
  });

  it("the house's blackjack beats a 21 of three cards", () => {
    expect(settle(hand("7S", "4H", "QD"), 50, hand("AD", "QC"))).toEqual({
      result: "LOSE",
      payout: -50,
    });
  });

  it("a bust loses even if the house busts too", () => {
    expect(settle(hand("KS", "QH", "5D"), 40, hand("10S", "6H", "9C"))).toEqual({
      result: "LOSE",
      payout: -40,
    });
  });

  it("higher total wins 1:1, the house busting pays, a tie is a push", () => {
    expect(settle(hand("10S", "9H"), 20, hand("10D", "8C"))).toEqual({ result: "WIN", payout: 20 });
    expect(settle(hand("10S", "7H"), 20, hand("10D", "8C"))).toEqual({
      result: "LOSE",
      payout: -20,
    });
    expect(settle(hand("10S", "2H"), 20, hand("10D", "6C", "8H"))).toEqual({
      result: "WIN",
      payout: 20,
    });
    expect(settle(hand("10S", "8H"), 20, hand("10D", "8C"))).toEqual({ result: "PUSH", payout: 0 });
  });

  it("bets are multiples of 10 from 10 to 200 and never more than the chips", () => {
    expect(BlackjackTable.adjustBet(55, 1000)).toBe(60);
    expect(BlackjackTable.adjustBet(500, 1000)).toBe(200);
    expect(BlackjackTable.adjustBet(0, 1000)).toBe(10);
    expect(BlackjackTable.adjustBet(200, 75)).toBe(70);
    expect(BlackjackTable.canPlay(10)).toBe(true);
    expect(BlackjackTable.canPlay(5)).toBe(false);
  });
});

describe("BasicStrategy (temporary CPU of C12)", () => {
  const choose = (codes: string[], up: string, canDouble = true) =>
    BasicStrategy.choose({
      round: 1,
      hand: hand(...codes),
      dealerUpcard: Card.parse(up),
      canDouble,
      shoe: new Shoe(new Rng(1)).composition(),
    });

  it("doubles 10 or 11 against 2 to 9, hits 16 against 10, stands 12 against 6", () => {
    expect(choose(["6S", "5H"], "6D")).toBe("DOUBLE");
    expect(choose(["6S", "5H"], "6D", false)).toBe("HIT");
    expect(choose(["6S", "5H"], "AD")).toBe("HIT");
    expect(choose(["10S", "6H"], "10D")).toBe("HIT");
    expect(choose(["10S", "2H"], "6D")).toBe("STAND");
    expect(choose(["10S", "7H"], "AD")).toBe("STAND");
    expect(choose(["AS", "6H"], "9D")).toBe("HIT");
    expect(choose(["AS", "7H"], "9D")).toBe("STAND");
  });
});
