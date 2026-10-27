import { UserFacingError } from "@/src/lib/errors";

// A failed Qloo call. The message is written for people; status is the HTTP status (0 for network failures).
export class QlooError extends UserFacingError {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "QlooError";
  }
}
