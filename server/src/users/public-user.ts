/**
 * What another user is allowed to see of a user: the id and the nickname,
 * nothing else (FR-12, design 7 "Nickname exposure"). Every later endpoint
 * that is not admin-only and renders a user other than the caller must go
 * through `toPublicUser`, so an email or a name can never leak by accident.
 */
export interface PublicUser {
  id: number;
  nickname: string | null;
}

export function toPublicUser<T extends PublicUser>(user: T): PublicUser {
  return { id: user.id, nickname: user.nickname };
}
