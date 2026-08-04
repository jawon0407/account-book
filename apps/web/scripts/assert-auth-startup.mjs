/**
 * Rejects a test-only authentication adapter before the production server process starts.
 * @param {Readonly<Record<string, string | undefined>>} environment - Server process variables; no secret values are read.
 */
function assertProductionAuthAdapter(environment) {
  if (
    environment.NODE_ENV === "production" &&
    environment.AUTH_ADAPTER_MODE === "fake"
  ) {
    throw new Error("AUTH_CONFIGURATION_INVALID");
  }
}

assertProductionAuthAdapter(process.env);
