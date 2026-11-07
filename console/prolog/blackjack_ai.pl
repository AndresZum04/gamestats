/*  Blackjack AI of GameConsole.

    Decides a CPU player's move by expected value (EV) and its bet by the
    Hi-Lo card count. Everything is computed from the composition of the shoe
    that the console sends with each query, so the AI "knows" which cards are
    left, as a card counter would.

    Rules it assumes (the ones of the console, see console/web/src/games/blackjack):
    the house hits below 17 and stands on any 17, a win pays 1:1, a tie is a
    push, going over 21 loses, doubling bets twice and takes exactly one card.

    Simplification: during one computation the probabilities of the cards do
    not change as cards are drawn ("infinite shoe" with the current
    composition). With 6 decks the error is a few thousandths of a chip.
*/
:- module(blackjack_ai,
          [ card_value/2,         % +Code, -Value
            hand_state/3,         % +Values, -Total, -Soft
            shoe_probs/2,         % +Counts, -Probs
            dealer_dist/4,        % +Probs, +Total, +Soft, -Dist
            ev_stand/4,           % +Probs, +Upcard, +Total, -EV
            ev_hit/5,             % +Probs, +Upcard, +Total, +Soft, -EV
            ev_double/5,          % +Probs, +Upcard, +Total, +Soft, -EV
            decide/5,             % +Hand, +Upcard, +Counts, +CanDouble, -Decision
            bet/6,                % +Counts, +Chips, +MinBet, +MaxBet, -Amount, -TrueCount
            hi_lo_true_count/2    % +Counts, -TrueCount
          ]).

:- use_module(library(apply)).
:- use_module(library(lists)).

/* ---------------------------------------------------------------------
   Cards and hands

   A card's value is 1 to 10: the ace is 1 (the hand decides whether it
   counts 11) and J, Q and K are 10. A hand is the pair Total-Soft: its best
   total and whether an ace is still counting 11.
   --------------------------------------------------------------------- */

%!  card_value(+Code, -Value) is det.
%   "10H" -> 10, "KS" -> 10, "AD" -> 1, "7C" -> 7. The last character is the suit.
card_value(Code, Value) :-
    string_length(Code, N),
    N >= 2,
    L is N - 1,
    sub_atom(Code, 0, L, 1, Rank),          % everything but the suit
    rank_value(Rank, Value).

rank_value('A', 1) :- !.
rank_value(R, 10) :- memberchk(R, ['J', 'Q', 'K']), !.
rank_value(R, V) :- atom_number(R, V), integer(V), V >= 2, V =< 10.

%!  add_card(+Total, +Soft, +Value, -Total2, -Soft2) is det.
%   Adds one card. An ace counts 11 if that does not pass 21. If a hard
%   total passes 21 while an ace counts 11, that ace goes back to 1.
add_card(T, _, 1, T2, true) :- T + 11 =< 21, !, T2 is T + 11.
add_card(T, S, V, T2, S2) :-
    T1 is T + V,
    (   T1 > 21, S == true
    ->  T2 is T1 - 10, S2 = false
    ;   T2 = T1, S2 = S
    ).

%!  hand_state(+Values, -Total, -Soft) is det.
%   Total and softness of a hand from the values of its cards.
hand_state(Values, Total, Soft) :-
    foldl([V, T0-S0, T-S]>>add_card(T0, S0, V, T, S), Values, 0-false, Total-Soft).

/* ---------------------------------------------------------------------
   Step 1: probability of each card value

   Counts is a list Value-Count (1 for the ace, 10 for tens and figures).
   Probs is the list Value-Probability, in the order of the values.
   --------------------------------------------------------------------- */

%!  shoe_probs(+Counts, -Probs) is det.
shoe_probs(Counts, Probs) :-
    sum_list_pairs(Counts, N),
    N > 0,
    findall(V-P, ( between(1, 10, V),
                   ( memberchk(V-C, Counts) -> true ; C = 0 ),
                   P is C / float(N) ),
            Probs).

sum_list_pairs(Pairs, Sum) :-
    foldl([_-C, A0, A]>>(A is A0 + C), Pairs, 0, Sum).

/* ---------------------------------------------------------------------
   Step 2: distribution of the house's final total

   Dist = [P17, P18, P19, P20, P21, PBust]. From a state Total-Soft of the
   house: over 21 is a bust; 17 or more stands; below 17 it draws, and the
   distribution is the sum, over every card, of its probability times the
   distribution of the new state. `:- table` keeps each state already solved
   (there are only a few dozen), so it is computed once per query.
   --------------------------------------------------------------------- */

:- table dealer_dist/4.

%!  dealer_dist(+Probs, +Total, +Soft, -Dist) is det.
dealer_dist(_, T, _, [0, 0, 0, 0, 0, 1]) :- T > 21, !.
dealer_dist(_, T, _, Dist) :-
    T >= 17, !,
    I is T - 17,
    length(Dist, 6),
    foldl([X, J0, J]>>(( J0 =:= I -> X = 1 ; X = 0 ), J is J0 + 1), Dist, 0, _).
dealer_dist(Probs, T, S, Dist) :-
    foldl(dealer_step(Probs, T, S), Probs, [0, 0, 0, 0, 0, 0], Dist).

dealer_step(Probs, T, S, V-P, Acc, Acc2) :-
    (   P =:= 0
    ->  Acc2 = Acc
    ;   add_card(T, S, V, T2, S2),
        dealer_dist(Probs, T2, S2, D),
        maplist([A, X, B]>>(B is A + P * X), Acc, D, Acc2)
    ).

%!  house_from_upcard(+Probs, +Upcard, -Dist) is det.
%   The house shows one card; the other is still to be drawn.
house_from_upcard(Probs, Up, Dist) :-
    add_card(0, false, Up, T, S),
    dealer_dist(Probs, T, S, Dist).

/* ---------------------------------------------------------------------
   Step 3: EV of standing

   With the house's distribution: win when it busts or ends lower, lose when
   it ends higher, push when equal. A total over 21 is -1.
   --------------------------------------------------------------------- */

%!  ev_stand(+Probs, +Upcard, +Total, -EV) is det.
ev_stand(_, _, T, -1) :- T > 21, !.
ev_stand(Probs, Up, T, EV) :-
    house_from_upcard(Probs, Up, [P17, P18, P19, P20, P21, PBust]),
    Finals = [17-P17, 18-P18, 19-P19, 20-P20, 21-P21],
    foldl([D-P, W0-L0, W-L]>>( D < T -> W is W0 + P, L = L0
                             ; D > T -> W = W0, L is L0 + P
                             ; W = W0, L = L0 ),
          Finals, PBust-0, Win-Lose),
    EV is Win - Lose.

/* ---------------------------------------------------------------------
   Step 4: EV of hitting

   For each possible card: its probability times the best of standing or
   hitting again with the new total; going over 21 is -1. It is recursive on
   the player's state and also tabled.
   --------------------------------------------------------------------- */

:- table ev_hit/5.

%!  ev_hit(+Probs, +Upcard, +Total, +Soft, -EV) is det.
ev_hit(Probs, Up, T, S, EV) :-
    foldl(hit_step(Probs, Up, T, S), Probs, 0, EV).

hit_step(Probs, Up, T, S, V-P, Acc, Acc2) :-
    (   P =:= 0
    ->  Acc2 = Acc
    ;   add_card(T, S, V, T2, S2),
        best_after_card(Probs, Up, T2, S2, E),
        Acc2 is Acc + P * E
    ).

best_after_card(_, _, T, _, -1) :- T > 21, !.
best_after_card(Probs, Up, T, S, E) :-
    ev_stand(Probs, Up, T, Stand),
    ev_hit(Probs, Up, T, S, Hit),
    E is max(Stand, Hit).

/* ---------------------------------------------------------------------
   Step 5: EV of doubling

   Twice the EV of taking exactly one card and standing.
   --------------------------------------------------------------------- */

%!  ev_double(+Probs, +Upcard, +Total, +Soft, -EV) is det.
ev_double(Probs, Up, T, S, EV) :-
    foldl([V-P, A0, A]>>( P =:= 0 -> A = A0
                        ; add_card(T, S, V, T2, _),
                          ev_stand(Probs, Up, T2, E),
                          A is A0 + P * E ),
          Probs, 0, One),
    EV is 2 * One.

/* ---------------------------------------------------------------------
   Step 6: the decision

   The action with the highest EV, with the three values so the console can
   explain it. Doubling only counts if CanDouble is true; otherwise its EV
   is null. On a tie the order is STAND, HIT, DOUBLE (the safest first).
   --------------------------------------------------------------------- */

%!  decide(+Hand, +Upcard, +Counts, +CanDouble, -Decision) is det.
%   Hand is a list of card codes, Upcard a code and Counts a list Value-Count.
%   Decision is decision{decision, evHit, evStand, evDouble, reason}.
decide(Hand, UpCode, Counts, CanDouble, Decision) :-
    abolish_private_tables,   % a new shoe: forget the states of the previous query
    shoe_probs(Counts, Probs),
    maplist(card_value, Hand, Values),
    hand_state(Values, T, S),
    card_value(UpCode, Up),
    ev_stand(Probs, Up, T, Stand0),
    ev_hit(Probs, Up, T, S, Hit0),
    round4(Stand0, Stand),
    round4(Hit0, Hit),
    (   CanDouble == true
    ->  ev_double(Probs, Up, T, S, Double0), round4(Double0, Double),
        Options = ['STAND'-Stand, 'HIT'-Hit, 'DOUBLE'-Double]
    ;   Double = null,
        Options = ['STAND'-Stand, 'HIT'-Hit]
    ),
    best_option(Options, Action-Best),
    reason(Action, Best, Options, Reason),
    Decision = decision{decision: Action, evHit: Hit, evStand: Stand,
                        evDouble: Double, reason: Reason}.

best_option([First|Rest], Best) :-
    foldl([A-E, BA-BE, R]>>( E > BE -> R = A-E ; R = BA-BE ), Rest, First, Best).

round4(X, R) :- R is round(X * 10000) / 10000.

action_name('HIT', pedir).
action_name('STAND', plantarse).
action_name('DOUBLE', doblar).

%   "pedir: EV -0.42 contra plantarse -0.54"
reason(Action, Best, Options, Reason) :-
    action_name(Action, Name),
    exclude([A-_]>>(A == Action), Options, Others),
    maplist([A-E, Txt]>>( action_name(A, N), format(string(Txt), "~w ~2f", [N, E]) ),
            Others, Parts),
    atomic_list_concat(Parts, ', ', Rest),
    format(string(Reason), "~w: EV ~2f contra ~w", [Name, Best, Rest]).

/* ---------------------------------------------------------------------
   The bet: Hi-Lo count

   The cards already played are those of a full 6 deck shoe that are no
   longer in Counts. Hi-Lo gives +1 to each 2 to 6 that came out, 0 to 7 to 9
   and -1 to each ten and ace: a positive count means the shoe is rich in
   tens and aces, which favours the player. The true count divides by the
   decks still in the shoe. The bet is the minimum unit times
   max(1, true count + 1) rounded up, limited by MaxBet and by the chips.
   --------------------------------------------------------------------- */

decks(6).

full_count(V, C) :- decks(D), ( V =:= 10 -> C is 16 * D ; C is 4 * D ).

hi_lo(V, 1) :- between(2, 6, V), !.
hi_lo(V, 0) :- between(7, 9, V), !.
hi_lo(_, -1).

%!  hi_lo_true_count(+Counts, -TrueCount) is det.
hi_lo_true_count(Counts, TrueCount) :-
    findall(Out-W, ( between(1, 10, V),
                     ( memberchk(V-Left, Counts) -> true ; Left = 0 ),
                     full_count(V, Full),
                     Out is max(0, Full - Left),
                     hi_lo(V, W) ),
            Played),
    foldl([N-W, A0, A]>>(A is A0 + N * W), Played, 0, Running),
    sum_list_pairs(Counts, Remaining),
    DecksLeft is max(Remaining / 52, 0.5),
    TrueCount is round(Running / DecksLeft * 10) / 10.

%!  bet(+Counts, +Chips, +MinBet, +MaxBet, -Amount, -TrueCount) is det.
bet(Counts, Chips, MinBet, MaxBet, Amount, TrueCount) :-
    hi_lo_true_count(Counts, TrueCount),
    Units is max(1, ceiling(TrueCount + 1)),
    Top is min(MaxBet, (Chips // MinBet) * MinBet),
    Amount is max(MinBet, min(Top, Units * MinBet)).
