import { ExtensionContext } from "vscode";
import { z } from "zod";

/**
 * A partial representation of the package.json file.
 *
 * VS Code does not expose a definition of the file / schema, so we need to
 * define it ourselves.
 *
 * The full schema can be found here: https://github.com/microsoft/vscode/blob/d0e9b3a84e4e2cb1ab0c7cc1c90acf75097d4f82/src/vs/platform/extensions/common/extensions.ts#L251-L279
 */
const PackageInfoSchema = z.object({
  publisher: z.string(),
  name: z.string(),
});
export type PackageInfo = z.infer<typeof PackageInfoSchema>;

export function getPackageInfo(context: ExtensionContext): PackageInfo {
  return PackageInfoSchema.parse(context.extension.packageJSON);
}
