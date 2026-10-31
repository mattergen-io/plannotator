import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

it("uses public BB APIs and declared Plannotator workspace packages", () => {
  const scan = experimental_scanPublicSdkOnly(fileURLToPath(new URL("..", import.meta.url)), { allow: [/^react(\/.*)?$/, /^@plannotator\/(ui|core)(\/.*)?$/, /^vitest(\/.*)?$/, /^@testing-library\/react$/] });
  expect(scan.violations).toEqual([]);
  expect(scan.privateDependencies).toEqual([]);
});
