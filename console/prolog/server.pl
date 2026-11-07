/*  HTTP server of the blackjack AI, port 4000 by default, 8 worker threads.

    POST /blackjack/decision
      {"hand": ["10H","6S"], "dealerUpcard": "9D",
       "shoe": {"A":20,"2":24,...,"10":90}, "canDouble": false}
      -> {"decision":"HIT","evHit":-0.42,"evStand":-0.54,"evDouble":null,
          "reason":"pedir: EV -0.42 contra plantarse -0.54"}

    POST /blackjack/bet
      {"shoe": {...}, "chips": 820, "minBet": 10, "maxBet": 200}
      -> {"amount":40,"trueCount":2.1,"reason":"conteo verdadero +2.1, 4 unidades"}

    GET /health -> {"status":"ok"}

    A body that is not valid gets 400 with {"error": "..."}.
    Each worker has its own tables (SWI-Prolog's default), so parallel
    queries never share or wait for each other's results.
*/
:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).
:- use_module(library(main)).
:- use_module(blackjack_ai).

:- initialization(main, main).

:- http_handler(root(health), health, [method(get)]).
:- http_handler(root(blackjack/decision), decision, [method(post)]).
:- http_handler(root(blackjack/bet), bet_handler, [method(post)]).

main(Argv) :-
    argv_options(Argv, _, Options),
    option(port(Port), Options, 4000),
    option(workers(Workers), Options, 8),
    http_server(http_dispatch, [port(Port), workers(Workers)]),
    format(user_error, "prolog ai ready on port ~w with ~w workers~n", [Port, Workers]),
    thread_get_message(stop).   % keep the main thread waiting; the workers serve

health(_Request) :-
    reply_json_dict(_{status: ok, service: "prolog"}).

decision(Request) :-
    with_body(Request, decision_reply).

bet_handler(Request) :-
    with_body(Request, bet_reply).

%   Reads the JSON body and answers with Goal, or 400 if the body is wrong.
with_body(Request, Goal) :-
    catch(( http_read_json_dict(Request, In),
            (   call(Goal, In, Out0)
            ->  Out = Out0
            ;   Out = error(400, "could not answer that query")
            ) ),
          Error,
          bad_request(Error, Out)),
    (   Out = error(Status, Message)
    ->  reply_json_dict(_{error: Message}, [status(Status)])
    ;   reply_json_dict(Out)
    ).

bad_request(invalid(Message), error(400, Message)) :- !.
bad_request(Error, error(400, Message)) :-
    format(string(Message), "bad request: ~q", [Error]).

decision_reply(In, Out) :-
    field(In, hand, Hand0),
    must(is_list(Hand0), "hand must be a list of cards"),
    maplist(card_code, Hand0, Hand),
    must(Hand \== [], "hand is empty"),
    field(In, dealerUpcard, Up0),
    card_code(Up0, Up),
    field(In, shoe, Shoe),
    shoe_counts(Shoe, Counts),
    (   get_dict(canDouble, In, CanDouble0) -> true ; CanDouble0 = false ),
    must(memberchk(CanDouble0, [true, false]), "canDouble must be true or false"),
    decide(Hand, Up, Counts, CanDouble0, Out).

bet_reply(In, _{amount: Amount, trueCount: TrueCount, reason: Reason}) :-
    field(In, shoe, Shoe),
    shoe_counts(Shoe, Counts),
    number_field(In, chips, Chips),
    number_field(In, minBet, MinBet),
    number_field(In, maxBet, MaxBet),
    must(MinBet > 0, "minBet must be positive"),
    bet(Counts, Chips, MinBet, MaxBet, Amount, TrueCount),
    Units is Amount // MinBet,
    ( TrueCount >= 0 -> Sign = "+" ; Sign = "" ),
    format(string(Reason), "conteo verdadero ~w~1f, ~w unidades", [Sign, TrueCount, Units]).

%   ---- Validation of the body --------------------------------------------

must(Goal, _) :- call(Goal), !.
must(_, Message) :- throw(invalid(Message)).

field(Dict, Key, Value) :-
    (   is_dict(Dict), get_dict(Key, Dict, Value)
    ->  true
    ;   format(string(M), "missing field ~w", [Key]), throw(invalid(M))
    ).

number_field(Dict, Key, Value) :-
    field(Dict, Key, Value),
    format(string(M), "~w must be a number", [Key]),
    must(number(Value), M).

card_code(Code0, Code) :-
    (   string(Code0) -> Code = Code0
    ;   atom(Code0) -> atom_string(Code0, Code)
    ;   throw(invalid("cards are strings like \"10H\""))
    ),
    format(string(M), "bad card ~w", [Code]),
    must(catch(card_value(Code, _), _, fail), M).

%   {"A":20,"2":24,...,"10":90} -> [1-20, 2-24, ..., 10-90]. JSON keys that
%   look like numbers arrive as integers, the ace as the atom 'A'.
shoe_counts(Shoe, Counts) :-
    must(is_dict(Shoe), "shoe must be an object"),
    dict_pairs(Shoe, _, Pairs),
    maplist(shoe_pair, Pairs, Counts),
    foldl([_-C, A0, A]>>(A is A0 + C), Counts, 0, Total),
    must(Total > 0, "the shoe is empty").

shoe_pair(Key-Count, V-Count) :-
    (   Key == 'A' -> V = 1
    ;   integer(Key) -> V = Key
    ;   atom(Key), atom_number(Key, V)
    ->  true
    ;   format(string(M), "bad shoe key ~w", [Key]), throw(invalid(M))
    ),
    format(string(M2), "bad shoe entry ~w", [Key]),
    must(( Key == 'A' ; between(2, 10, V) ), M2),
    must(( integer(Count), Count >= 0 ), M2).
