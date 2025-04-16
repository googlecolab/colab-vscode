import {Builder, By, WebDriver, until} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";
import * as vscode from "vscode-extension-tester";
import {TitleBar} from "vscode-extension-tester";

describe('Create notebook, auth, and connect to runtime', () => {
  let chromeDriver: WebDriver;
  const chromeOptions = new chrome.Options();

  before(() => {
    chromeOptions.excludeSwitches("headless");
    chromeOptions.windowSize({width: 501, height: 500});
    chromeOptions.setUserPreferences({
      'profile.content_settings.exceptions.clipboard': {
        '*,*': { setting: 1 } // 0:c prompt, 1: allow, 2: block
      }
    });
  });

  // after(async () => {
  //   await chromeDriver.close();
  // });

  it('Create notebook via command prompt', async () => {
    const menu = await new TitleBar().getItem("File");
    const context = await menu?.select()
    const file = await context?.getItem("New File...");
    await file?.click();

    const prompt = new vscode.InputBox;
    const qp = await prompt.getQuickPicks();
    for (const q of qp) {
      const text = await q.getText();
      if (text.includes("Jupyter")) {
        await q.click();
      }
    }

    const editorView = new vscode.EditorView();
    const editor = await editorView.openEditor('Untitled-1.ipynb');
    const selectKernelXPath = '/html/body/div/div[6]/div[1]/div[2]/div/div/ul/li/a[2]'

    await editor.getDriver().wait(until.elementLocated(By.css('.cell-editor-container')));
    const el = await editor.findElement(By.xpath(selectKernelXPath));
    await el.click();

    const input = new vscode.InputBox;
    await input.wait(0);
    const item = await input.findQuickPick("Colab");
    if (!item) {
      throw new Error("item is undefined");
    }
    await item.click()

    const input2 = new vscode.InputBox
    await input2.wait(0);
    const newServer = await input2.findQuickPick(" New Colab Server");
    if (!newServer) {
      throw new Error("newServer is undefined");
    }
    await newServer.click();

    const dialog = new vscode.ModalDialog();
    await dialog.pushButton("Allow");

    const dialog2 = new vscode.ModalDialog();
    await dialog2.pushButton("Copy");

    chromeDriver = await new Builder().forBrowser("chrome").setChromeOptions(chromeOptions).build();
    await chromeDriver.navigate().to("https://google.com");
    const clipboardData = await getClipboardContents(chromeDriver);

    // const emailNextButton = By.id("identifierNext");
    await chromeDriver.navigate().to(clipboardData!);
    await chromeDriver.wait(until.urlContains("accounts.google.com"));
    await chromeDriver.navigate().to("https://accounts.google.com/MergeSession?source=TAS_drakeaiman&uberauth=APh-3FwHnJzLyRXTTtrivfnbdZnUhe9KUVYY-tKwInKkJZjA8BAhtV4oO1U2yWdgkYwS09P9x_uRdcd7dWRs04-RoJOTyuyh_q-G5LnXQ9987oOfsRymXcz5Vjt11cjCH52AYY67SFWTgzgUPCdE_Fw_pPufHGL52mQOF6MhRxTTDqRpf1hWhxFGCYeKL__i2ynlntcLJiaE8Q3Dp3UcNV2g7EwicNjDVxRG67nmfraPH2NA8sYHA7YdPLADduevI5-B7R9v4FbNTt0jIdlgzlcopGHhCDiwDbOyvzdDYSBZFuAcco53h0SNHCw4TlA79ThPhAlLVVAfvHGPOuqNPplRdFTdVoA6pHkIhlus6RtSSy9f1PKNBUhPJHii6lvcklioQl29a8DUqX5vEIR3iPnl0JjwsuVgsTuFQXFcWo45MXDXW_T5vY5YB_0gPyb6VxDebaqJsoMXN5HqPLUC7MtLJ1B9fgUspd9g1V6A9Tx_P0HHoM1njPlksc1TFr5csEXsISZpzI-zjmXA-bJzL5nvfMOsOjHxtR51A4po90bDON57oXu6ZGMfrHOe3CcOfAfhcLG9Teos7ds5nNSTp4YaSWs-10pBJAoeCcXFkDVlpA_0RrQt8CpF5aLJb8I5bkzfpPmSoZWw0T2oA-6RR-8u0kY_cGoUpkExg-BV4TZ5_HJRVgnCMWBS7mOlDM7xMMeAcyXlKOlJgvxZOKS0Z2eJqyjA89CzGokDqx_CzlPFqbiHY1BXzXLEtY7knHwqdJvEkEwjRkdmriI3G9pD1zL6YTj2mkBMr-lmcUYMOZwto-qE6LF5et2JIph41fbFYYIjJTWJ6PCreS-vxRGec9-HznBR2_AyiBgCzRiunGpd_UnyhZSaind7DJhf0YYh_qqPjom3xjTyOdta5bMG1E3dttOn_uvPpj8y6AqourR42m7jSOVUvDZepV03SUdF-mVV8LGRhL-XPttv7TWlb2DRDPenG44mqADE5EWCIjmMxA9J4LbFG_yQoMl6HgWvZDEFnPiysXNJ2rU2jFFm6EGqawduEmZJ4gOrr1EiVJcO9uPCsw5v81fiErashj3eiu0eESl4Xg-Fn6HffWnkw0AqcqpHM8FxXgdprXODuIyY9x_d1SiVw5u7UH-nj1OcUuV0KcvPaLY6i7PPsZir8HElqo9DcMNpYWGbfB8oweUG7FOQKyRTtH01cHPWvymAt6wiQyLjWLzKFeY_cOI_XQgAWDTsQyJ-gjUTuTsrWfDp6vvRwSzFMWa9DxqzS5e_F7eeurW_nMFYWYUevD0Qhp5bj5kTivSmSiVcCsNxaSRLQhesBTrvBzw&continue=https://accounts.google.com/");
    await chromeDriver.close();

    // await chromeDriver.wait(until.elementLocated(emailNextButton));
    // const emailInput = await chromeDriver.findElement(By.css("#identifierId"));
    // await emailInput.sendKeys("datalabprovervscode@gmail.com");
    // await (await chromeDriver.findElement(emailNextButton)).click();

    // // I haven't gotten here yet.
    // const passwordNextButton = By.id("passwordNext");
    // await chromeDriver.wait(until.elementLocated(passwordNextButton));
    // const passwordInput = await chromeDriver.findElement(By.className("whs0nd zH1kBf"));
    // await passwordInput.sendKeys("mQeKb87rS");
    // await (await chromeDriver.findElement(passwordNextButton)).click();

    const cell = await editor.getDriver().findElement(By.css('textarea'));
    await cell.sendKeys("print('hello')");
    const play = await editor.findElement(By.css('.codicon-notebook-execute'));
    await play.click()

    console.log("logged in");

  });
});

async function getClipboardContents(driver: WebDriver): Promise<string | null> {
    return driver.executeScript('return navigator.clipboard.readText()');
}
