function setValidationToWarnOnly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bisSheet = ss.getSheetByName("BiS List");
  const dataRange = bisSheet.getDataRange();
  const numRows = dataRange.getNumRows();
  const numCols = dataRange.getNumColumns();

  for (let r = 1; r <= numRows; r++) {
    const rowRange = bisSheet.getRange(r, 1, 1, numCols);
    const rules = rowRange.getDataValidations()[0];
    const newRules = rules.map(rule =>
      rule ? rule.copy().setAllowInvalid(true).build() : null
    );
    rowRange.setDataValidations([newRules]);
  }
  SpreadsheetApp.getUi().alert("✅ All validation rules set to warn only.");
}
