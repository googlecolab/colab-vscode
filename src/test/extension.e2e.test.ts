import * as fs from "fs";
import dotenv from "dotenv";
import * as chrome from "selenium-webdriver/chrome";
import {
  Builder,
  By,
  InputBox,
  Key,
  ModalDialog,
  WebDriver,
  Workbench,
  VSBrowser,
  until,
} from "vscode-extension-tester";

const ELEMENT_WAIT_MS = 10000;

describe("Colab Extension", function () {
  dotenv.config();

  let driver: WebDriver;
  let testTitle: string;
  let workbench: Workbench;

  before(async () => {
    // Wait for the extension to be installed.
    workbench = new Workbench();
    driver = workbench.getDriver();
    await driver.sleep(4000);
  });

  beforeEach(function () {
    testTitle = this.currentTest?.fullTitle() ?? "";
  });

  describe("with a notebook", () => {
    beforeEach(async () => {
      // Create an executable notebook. Note that it's created with a single
      // code cell by default.
      await workbench.executeCommand("Create: New Jupyter Notebook");
      await workbench.executeCommand("Notebook: Edit Cell");
      const cell = await driver.switchTo().activeElement();
      await cell.sendKeys("1 + 1");
    });

    it("authenticates and executes the notebook on a Colab server", async () => {
      // Select the Colab server provider from the kernel selector.
      await workbench.executeCommand("Notebook: Select Notebook Kernel");
      let inputBox = await InputBox.create();
      await inputBox.selectQuickPick("Select Another Kernel...");
      inputBox = await InputBox.create();
      await inputBox.selectQuickPick("Colab");

      // Accept the dialog allowing the Colab extension to sign in using Google.
      let dialog = new ModalDialog();
      await dialog.pushButton("Allow");

      // Begin the sign-in process by copying the OAuth URL to the clipboard and
      // opening it in a browser window. Why do this instead of triggering the
      // "Open" button in the dialog? We copy the URL so that we can use a new
      // driver instance for the OAuth flow, since the original driver instance
      // does not have a handle to the window that would be spawned with "Open".
      dialog = new ModalDialog();
      await dialog.pushButton("Copy");
      // TODO: Remove this dynamic import
      const clipboardy = await import("clipboardy");
      await doOauthSignIn(/* oauthUrl= */ clipboardy.default.readSync());

      // Now that we're authenticated, we can resume creating a Colab server via
      // the open kernel selector.
      inputBox = await InputBox.create();
      await inputBox.selectQuickPick("New Colab Server");
      // Select the variant.
      inputBox = await InputBox.create();
      await inputBox.selectQuickPick("CPU");
      // Alias the server with the default name.
      inputBox = await InputBox.create();
      await inputBox.sendKeys(Key.ENTER);
      // Select the kernel.
      inputBox = await InputBox.create();
      await inputBox.selectQuickPick("Python 3 (ipykernel)");

      // Execute the notebook and poll for the success indicator (green check).
      // Why not the cell output? Because the output is rendered in a webview.
      await workbench.executeCommand("Notebook: Run All");
      await driver.wait(async () => {
        const element = await workbench
          .getEnclosingElement()
          .findElements(By.className("codicon-notebook-state-success"));
        return element.length > 0;
      }, ELEMENT_WAIT_MS);
    });
  });

  /**
   * Performs the OAuth sign-in flow for the Colab extension.
   */
  async function doOauthSignIn(oauthUrl: string): Promise<void> {
    const oauthDriver = await getOAuthDriver();

    try {
      await oauthDriver.get(oauthUrl);

      // Input the test account email address.
      const emailInput = await oauthDriver.findElement(
        By.css("input[type='email']"),
      );
      await emailInput.sendKeys(process.env.TEST_ACCOUNT_EMAIL ?? "");
      await emailInput.sendKeys(Key.ENTER);

      // Input the test account password. Note that we wait for the page to
      // settle to avoid getting a stale element reference.
      await oauthDriver.wait(
        until.urlContains("accounts.google.com/v3/signin/challenge"),
        ELEMENT_WAIT_MS,
      );
      await oauthDriver.sleep(1000);
      const passwordInput = await oauthDriver.findElement(
        By.css("input[type='password']"),
      );
      await passwordInput.sendKeys(process.env.TEST_ACCOUNT_PASSWORD ?? "");
      await passwordInput.sendKeys(Key.ENTER);

      // Click Continue to sign in to Colab.
      await oauthDriver.wait(
        until.urlContains("accounts.google.com/signin/oauth/id"),
        ELEMENT_WAIT_MS,
      );
      let continueButton = await oauthDriver.findElement(
        By.xpath("//span[text()='Continue']"),
      );
      await continueButton.click();

      // Click Continue to allow the Colab extension to access the account.
      await oauthDriver.wait(
        until.urlContains("accounts.google.com/signin/oauth/v2/consent"),
        ELEMENT_WAIT_MS,
      );
      continueButton = await oauthDriver.findElement(
        By.xpath("//span[text()='Continue']"),
      );
      await continueButton.click();

      // The test account should be authenticated. Close the browser window.
      await oauthDriver.wait(until.urlContains("127.0.0.1"), ELEMENT_WAIT_MS);
      await oauthDriver.quit();
    } catch (_) {
      // If the OAuth flow fails, ensure we grab a screenshot for debugging.
      const screenshotsDir = VSBrowser.instance.getScreenshotsDir();
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      fs.writeFileSync(
        `${screenshotsDir}/${testTitle} (oauth window).png`,
        await oauthDriver.takeScreenshot(),
        "base64",
      );
      throw _;
    }
  }
});

/**
 * Creates a new WebDriver instance for the OAuth flow.
 */
function getOAuthDriver(): Promise<WebDriver> {
  const isHeadlessMode = process.argv.includes("--headless");
  if (isHeadlessMode) {
    // Without the provided user agent, the OAuth flow fails with a 500.
    return new Builder()
      .forBrowser("chrome")
      .setChromeOptions(
        new chrome.Options()
          .addArguments("--headless")
          .addArguments(
            '--user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36"',
          ) as chrome.Options,
      )
      .build();
  }
  return new Builder().forBrowser("chrome").build();
}
