const isDebugMode = process.argv.includes("--debug");
module.exports = {
  timeout: isDebugMode ? 99999999 : "2m",
};
