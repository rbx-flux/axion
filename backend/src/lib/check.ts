// The licence check every build runs, and the alarms it raises.

import { findLicense, findLicenseByKey, raiseAlarm, type LicenseRow } from "./db";
import { constantTimeEquals } from "./http";

export interface Assessment {
  license: LicenseRow | null;
  licensed: boolean;
  // null when the build sent no key.
  keyValid: boolean | null;
  owned: boolean;
}

// Is `creatorId` licensed, and is `key` (when sent) the one issued to them?
// Anything off raises exactly one collapsed alarm:
//   key_mismatch  the key belongs to another user (a leaked build)
//   unknown_key   the key belongs to nobody
//   unlicensed    no licence and no key to speak of
export async function assess(
  db: D1Database,
  creatorId: number,
  key: string | null,
  gameId: number | null,
): Promise<Assessment> {
  const license = await findLicense(db, creatorId);
  const licensed = license !== null;
  let keyValid: boolean | null = null;

  if (key !== null) {
    const issued = license?.key ?? null;
    keyValid = issued !== null && constantTimeEquals(key, issued);
    if (!keyValid) {
      const owner = await findLicenseByKey(db, key);
      if (owner !== null) {
        await raiseAlarm(db, {
          kind: "key_mismatch",
          level: "error",
          creatorId,
          key,
          keyOwnerId: owner.creator_id,
          gameId,
          detail: `key issued to ${owner.creator_id} presented by ${creatorId}`,
        });
      } else {
        await raiseAlarm(db, {
          kind: "unknown_key",
          level: "warn",
          creatorId,
          key,
          gameId,
          detail: licensed ? "licensed user presented a key that was never issued" : null,
        });
      }
    }
  } else if (!licensed) {
    await raiseAlarm(db, { kind: "unlicensed", level: "warn", creatorId, gameId });
  }

  // A build must present its own key; a licensed id alone is not enough.
  return { license, licensed, keyValid, owned: licensed && keyValid === true };
}
