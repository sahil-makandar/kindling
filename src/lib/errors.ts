// An error whose message is written for people and is safe to show in the UI.
// Anything that is not a UserFacingError is treated as internal and replaced by a generic message.
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
