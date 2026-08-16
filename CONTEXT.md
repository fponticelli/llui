# LLui

LLui is a typed UI framework whose domain language describes authored interfaces, runtime state, and browser navigation.

## Routing

**Named route**:
A uniquely keyed route definition that owns one URL contract and the rules for parsing and formatting its parameters.
_Avoid_: Route tag, route location

**Route location**:
The named, serializable value returned by URL matching and accepted by URL generation. It contains only URL identity; matching and generation are inverse views of the same location.
_Avoid_: Matched route object, href input

**Route parameters**:
The typed, validated semantic values that distinguish one location of a named route from another, presented independently of whether the URL stores them in its path or query string.
_Avoid_: Path params, query params

**Route codec**:
A bidirectional contract that parses and validates one or more URL values into a typed route parameter and formats that parameter back into its canonical URL representation.
_Avoid_: Param parser, validator

**Canonical URL**:
The single URL generated for a route location after defaults are normalized; equivalent input URLs may match the same location, but generation emits this preferred form.
_Avoid_: Normalized href, preferred path

**Page state**:
Application state associated with rendering or interacting with a page, such as loaded data, drafts, or pending status; it is not part of route location.
_Avoid_: Route data, non-URL route fields

**Unmatched URL**:
A URL that does not validate as any named route; it carries no route location and leaves not-found or redirect policy to the application.
_Avoid_: Fallback route, invalid route
