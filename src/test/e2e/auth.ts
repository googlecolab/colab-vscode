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
    By.css("input[type='email']"),
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
  await chromeDriver.wait(until.urlContains('consent'), ELEMENT_WAIT_MS);
  await safeClick(
    chromeDriver,
    By.xpath("//span[text()='Allow' or text()='Continue']"),
    '"Allow" or "Continue" button not visible on consent screen',
  );

  // Check that the test account's authenticated.
  await chromeDriver.wait(
    until.urlContains(expectedRedirectUrl),
    ELEMENT_WAIT_MS,
  );
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
