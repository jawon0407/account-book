import { describe, expect, it } from "vitest";
import { ClientError } from "../api/client-error";
import {
  collectorStateCopy,
  collectorConfirmationCopy,
  collectorFailure,
  COLLECTOR_PREPARATION,
} from "./collector-copy";

describe("collector copy", () => {
  it("labels designation, not active notification capture", () => {
    expect(collectorStateCopy("inactive").title).toBe("지정된 기기 없음");
    expect(collectorStateCopy("active_here").title).toBe(
      "이 기기가 지정되어 있어요",
    );
    expect(collectorStateCopy("active_elsewhere").title).toBe(
      "다른 기기가 지정되어 있어요",
    );
    expect(COLLECTOR_PREPARATION).toContain(
      "거래를 자동 저장하지 않아요",
    );
  });
  it("explains remote replacement and deactivation impacts", () => {
    expect(
      collectorConfirmationCopy({
        action: "activate",
        expectedVersion: 2,
        replaceExisting: true,
      }).body,
    ).toContain("다른 기기의 지정은 해제");
    expect(
      collectorConfirmationCopy({ action: "deactivate", expectedVersion: 2 })
        .body,
    ).toContain("다른 기기가 지정되어 있어도");
  });
  it("never copies raw errors and distinguishes conflict and uncertainty", () => {
    expect(collectorFailure(new Error("secret"), "read")).not.toContain(
      "secret",
    );
    expect(
      collectorFailure(new ClientError("COLLECTOR_VERSION_CONFLICT"), "change"),
    ).toContain("변경");
    expect(collectorFailure(new ClientError("NETWORK"), "change")).toContain(
      "결과를 확정할 수 없어요",
    );
  });
});
