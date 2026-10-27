import "dotenv/config";
import { upgradeConfiguredSafetySchema } from "../server/schemaUpgrade";

upgradeConfiguredSafetySchema()
  .then(changes => {
    console.log(
      changes.length
        ? `Additive schema upgrade complete: ${changes.join(", ")}`
        : "Required schema objects already exist; no changes needed."
    );
  })
  .catch(() => {
    console.error(
      "Schema upgrade failed. Check database access and the existing base schema. No partial upgrade was committed."
    );
    process.exitCode = 1;
  });
