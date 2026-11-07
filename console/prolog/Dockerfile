# Blackjack AI in SWI-Prolog: HTTP server on port 4000 with 8 worker threads.
FROM swipl:10.0.2

WORKDIR /app
COPY blackjack_ai.pl server.pl ./

# Run as a user without privileges.
RUN useradd --system --no-create-home prolog
USER prolog

EXPOSE 4000

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=20 \
  CMD ["swipl", "-g", "use_module(library(http/http_open)),http_open('http://localhost:4000/health',S,[]),close(S)", "-t", "halt"]

CMD ["swipl", "/app/server.pl", "--port=4000", "--workers=8"]
