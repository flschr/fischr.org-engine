const { isContentOnlyPath, plan } = require("../../blog/admin/publish-plan");

function validationMode(changedPaths) {
  return plan(changedPaths).mode;
}

module.exports = { isContentOnlyPath, plan, validationMode };
