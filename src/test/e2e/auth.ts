/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as chrome from 'selenium-webdriver/chrome';
import { Builder, By, Key, WebDriver, until } from 'vscode-extension-tester';
import { safeClick } from './ui';

const ELEMENT_WAIT_MS = 10000;
const SIGN_IN_SCREEN_WAIT_MS = 20000;

/**
 * Performs the OAuth sign-in flow for the Colab extension.
 *
 * @param chromeDriver - The Chrome driver.
 * @param oAuthUrl - The OAuth url.
 * @param expectedRedirectUrl - The expected redirect url.
 */
export async function doOAuthSignIn(
  chromeDriver: WebDriver,
  oAuthUrl: string,
  expectedRedirectUrl: string,
): Promise<void> {
  await chromeDriver.get(oAuthUrl);

  // Input the test account email address.
  const emailInput = await chromeDriver.findElement(
    By.css("input[aria-label*='email' i]"),
  );
  await emailInput.clear();
  await emailInput.sendKeys(process.env.TEST_ACCOUNT_EMAIL ?? '');
  await emailInput.sendKeys(Key.ENTER);

  // Input the test account password. Note that we wait for the page to
  // settle to avoid getting a stale element reference.
  await chromeDriver.wait(
    until.urlContains('accounts.google.com/v3/signin/challenge'),
    ELEMENT_WAIT_MS,
  );
  await chromeDriver.sleep(1000);
  const passwordInput = await chromeDriver.findElement(
    By.css("input[type='password']"),
  );
  await passwordInput.sendKeys(process.env.TEST_ACCOUNT_PASSWORD ?? '');
  await passwordInput.sendKeys(Key.ENTER);

  // Click Continue to sign in to Colab.
  await chromeDriver.wait(
    until.urlContains('accounts.google.com/signin/oauth/id'),
    SIGN_IN_SCREEN_WAIT_MS,
  );
  await safeClick(
    chromeDriver,
    By.xpath("//span[text()='Continue']"),
    '"Continue" button not visible on ID screen',
  );

  // Click Allow or Continue to authorize the scope (handles both v1 and v2
  // consent screens).
  // Match the path, not just "consent": the OAuth query carries
  // `prompt=consent`, so a bare substring matches the ID screen too.
  await chromeDriver.wait(
    until.urlMatches(/accounts\.google\.com\/signin\/oauth\/(v\d+\/)?consent/),
    ELEMENT_WAIT_MS,
  );
  const consentButton = By.xpath("//span[text()='Allow' or text()='Continue']");
  await chromeDriver.wait(until.elementLocated(consentButton), ELEMENT_WAIT_MS);
  await grantAllGranularScopes(chromeDriver);
  await safeClick(
    chromeDriver,
    consentButton,
    '"Allow" or "Continue" button not visible on consent screen',
  );

  // Check that the test account's authenticated.
  await chromeDriver.wait(
    until.urlContains(expectedRedirectUrl),
    ELEMENT_WAIT_MS,
  );
}

/**
 * Ticks "Select all" on a granular consent screen
 * (`enable_granular_consent=true`), whose per-scope checkboxes start
 * unchecked. Continuing without them grants nothing, yet still redirects.
 *
 * @param chromeDriver - The Chrome driver, on the consent screen.
 */
async function grantAllGranularScopes(chromeDriver: WebDriver): Promise<void> {
  const selectAll = await chromeDriver.findElements(
    By.xpath(
      "//input[@type='checkbox'][@aria-labelledby=//*[normalize-space()='Select all']/@id]",
    ),
  );
  if (selectAll.length === 0) {
    console.log('No "Select all" on the consent screen; nothing to tick');
    return;
  }
  // The native input sits under Material styling, so a WebDriver click can be
  // intercepted; a DOM click fires the same change handler.
  await chromeDriver.executeScript(
    'if (!arguments[0].checked) arguments[0].click();',
    selectAll[0],
  );
  const unchecked = await chromeDriver.executeScript<number>(
    `return [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((c) => !c.checked).length;`,
  );
  if (unchecked > 0) {
    throw new Error(
      `${unchecked.toString()} consent checkbox(es) still unchecked after "Select all"`,
    );
  }
  console.log('Ticked "Select all" on the consent screen');
}

/**
 * Creates a new Chrome WebDriver instance for the OAuth flow.
 *
 * @returns The Chrome WebDriver instance.
 */
export function getOAuthDriver(): Promise<WebDriver> {
  const authDriverArgsPrefix = '--auth-driver:';
  const authDriverArgs = process.argv
    .filter((a) => a.startsWith(authDriverArgsPrefix))
    .map((a) => a.substring(authDriverArgsPrefix.length));
  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(
      new chrome.Options().addArguments(...authDriverArgs) as chrome.Options,
    )
    .build();
}
