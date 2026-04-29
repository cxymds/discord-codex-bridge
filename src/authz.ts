import type { DiscordActor } from "./types.js";

export function isAuthorized(actor: DiscordActor, allowedUserIds: string[], allowedRoleIds: string[]): boolean {
  if (allowedUserIds.includes(actor.userId)) {
    return true;
  }

  return actor.roleIds.some((roleId) => allowedRoleIds.includes(roleId));
}
