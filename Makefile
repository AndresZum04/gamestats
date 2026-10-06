# Atajos de desarrollo. Requiere make, Go y sbt (o Docker para sbt, ver SBT).
#
# Sin sbt instalado se puede compilar Scala con Docker:
#   make build SBT="docker run --rm -v $(CURDIR):/repo -w /repo/analyzer sbtscala/scala-sbt:eclipse-temurin-21.0.12_8_1.13.0_3.3.8 sbt"

SBT ?= sbt
GO  ?= go

.PHONY: build test fmt run-ingestor run-analyzer simulate up down demo

build:
	cd ingestor && $(GO) build ./...
	cd simulator && $(GO) build ./...
	cd analyzer && $(SBT) -batch compile

test:
	cd ingestor && $(GO) test -race ./...
	cd simulator && $(GO) test -race ./...
	cd analyzer && $(SBT) -batch test

fmt:
	gofmt -w ingestor simulator
	cd analyzer && $(SBT) -batch scalafmtAll

run-ingestor:
	cd ingestor && $(GO) run ./cmd/ingestor

run-analyzer:
	cd analyzer && $(SBT) run

simulate:
	cd simulator && $(GO) run ./cmd/simulator --mode stream --events-dir ../data/events

up:
	docker compose up -d --build

down:
	docker compose down

demo:
	./scripts/demo.sh
