// Streaming JSON encoder (M20).
//
// Emits the report object exactly as the /api/reports endpoints return it —
// same key order, same values — but serialized piecewise (one chunk per
// key/value and per array element). The response body is therefore never
// materialized as a single giant string (D20.2); the only in-memory form is
// the report payload the report service already built.

export function* jsonChunks(report: object): Generator<Buffer> {
  yield Buffer.from("{");

  let firstKey = true;
  for (const [key, value] of Object.entries(report)) {
    yield Buffer.from((firstKey ? "" : ",") + JSON.stringify(key) + ":");
    firstKey = false;

    if (Array.isArray(value)) {
      yield Buffer.from("[");
      let firstElement = true;
      for (const element of value) {
        yield Buffer.from((firstElement ? "" : ",") + JSON.stringify(element));
        firstElement = false;
      }
      yield Buffer.from("]");
    } else {
      yield Buffer.from(JSON.stringify(value));
    }
  }

  yield Buffer.from("}");
}
