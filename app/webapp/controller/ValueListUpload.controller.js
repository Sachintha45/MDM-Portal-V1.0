sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/dom/includeScript"
], function (Controller, JSONModel, Filter, FilterOperator, Sorter, MessageToast, MessageBox, includeScript) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ValueListUpload", {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy: false,
                selectedTable: "",
                summaryText: "",
                dataTitle: "Data"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [] }), "sum");
            this.getView().setModel(new JSONModel({ items: [] }), "data");

            this.getOwnerComponent().getRouter()
                .getRoute("valueListUpload").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._loadSummary();
        },

        // ── Summary (one row per uploaded table) ─────────────────────
        _loadSummary: function (sSelectTable) {
            var oModel = this.getOwnerComponent().getModel();
            var pSummary = oModel.bindList("/ValueListSummary", null, [new Sorter("table_name")], [], {
                $select: "table_name,row_count,last_upload"
            }).requestContexts(0, Infinity);
            // value tables whose Backend Table matches an uploaded table
            var pVT = oModel.bindList("/ValueTables", null, null, [], {
                $select: "value_table_id,source_table"
            }).requestContexts(0, Infinity);

            this._oViewModel.setProperty("/busy", true);
            return Promise.all([pSummary, pVT]).then(function (aRes) {
                var mUsers = {};
                aRes[1].forEach(function (c) {
                    var t = (c.getProperty("source_table") || "").trim().toUpperCase();
                    if (!t) { return; }
                    (mUsers[t] = mUsers[t] || []).push(c.getProperty("value_table_id"));
                });
                var iRows = 0;
                var aItems = aRes[0].map(function (c) {
                    var t = c.getProperty("table_name");
                    var a = mUsers[t] || [];
                    var n = c.getProperty("row_count") || 0;
                    iRows += n;
                    var d = c.getProperty("last_upload");
                    return {
                        table_name: t,
                        row_count: n,
                        used_by: a.length ? a.join(", ") : "No value table uses this table",
                        used_by_count: a.length,
                        last_upload_text: d ? new Date(d).toLocaleString() : "\u2014"
                    };
                });
                this.getView().getModel("sum").setProperty("/items", aItems);
                this._oViewModel.setProperty("/summaryText",
                    aItems.length + " table(s) \u00b7 " + iRows + " row(s)");

                var sSel = sSelectTable || this._oViewModel.getProperty("/selectedTable");
                var bStill = aItems.some(function (o) { return o.table_name === sSel; });
                if (!bStill) { sSel = aItems.length ? aItems[0].table_name : ""; }
                return this._selectTable(sSel);
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load value list data: " + (e.message || "Unknown error"));
            }).then(function () {
                this._oViewModel.setProperty("/busy", false);
            }.bind(this));
        },

        // keep the highlighted row in sync after the summary list re-renders
        onSummaryUpdated: function () {
            var oTable = this.byId("summaryTable");
            var sSel = this._oViewModel.getProperty("/selectedTable");
            oTable.getItems().forEach(function (oItem) {
                var o = oItem.getBindingContext("sum").getObject();
                if (o.table_name === sSel && !oItem.getSelected()) { oTable.setSelectedItem(oItem); }
            });
        },

        onSummarySelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            if (!oItem) { return; }
            this._selectTable(oItem.getBindingContext("sum").getProperty("table_name"));
        },

        // ── Data of the selected table ───────────────────────────────
        _selectTable: function (sTable) {
            this._oViewModel.setProperty("/selectedTable", sTable);
            if (!sTable) {
                this.getView().getModel("data").setProperty("/items", []);
                this._oViewModel.setProperty("/dataTitle", "Data");
                return Promise.resolve();
            }
            var oModel = this.getOwnerComponent().getModel();
            return oModel.bindList("/ValueListEntries", null, [new Sorter("line_no")], [
                new Filter("table_name", FilterOperator.EQ, sTable)
            ], {
                $select: "line_no,area,field_value_1,field_value_2,field_value_3,field_value_4,field_value_5"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aItems = aCtx.map(function (c) {
                    return {
                        line_no: c.getProperty("line_no"),
                        area: c.getProperty("area") || "",
                        field_value_1: c.getProperty("field_value_1") || "",
                        field_value_2: c.getProperty("field_value_2") || "",
                        field_value_3: c.getProperty("field_value_3") || "",
                        field_value_4: c.getProperty("field_value_4") || "",
                        field_value_5: c.getProperty("field_value_5") || ""
                    };
                });
                this.getView().getModel("data").setProperty("/items", aItems);
                this._oViewModel.setProperty("/dataTitle", "Data of " + sTable + " (" + aItems.length + ")");
                this.onSummaryUpdated();
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load data of " + sTable + ": " + (e.message || "Unknown error"));
            });
        },

        onDataSearch: function (oEvent) {
            var sQuery = (oEvent.getParameter("newValue") || "").trim();
            var oBinding = this.byId("dataTable").getBinding("items");
            if (!oBinding) { return; }
            if (!sQuery) { oBinding.filter([]); return; }
            var aFields = ["area", "field_value_1", "field_value_2", "field_value_3", "field_value_4", "field_value_5"];
            oBinding.filter(new Filter({
                filters: aFields.map(function (f) { return new Filter(f, FilterOperator.Contains, sQuery); }),
                and: false
            }));
        },

        // ── Excel / CSV handling ─────────────────────────────────────
        // SheetJS is loaded on demand (only when this page is actually used).
        _loadXlsx: function () {
            if (window.XLSX) { return Promise.resolve(window.XLSX); }
            return includeScript(sap.ui.require.toUrl("mdm/portal/lib/xlsx.full.min.js"))
                .then(function () {
                    if (!window.XLSX) { throw new Error("Excel library could not be loaded."); }
                    return window.XLSX;
                });
        },

        onDownloadTemplate: function () {
            this._loadXlsx().then(function (X) {
                var aoa = [
                    ["Table", "Area", "Field Value 1", "Field Value 2", "Field Value 3", "Field Value 4", "Field Value 5"],
                    ["TVSD", "BP", "A", "FT-Direct Cust (VAT)", "", "", ""],
                    ["", "", "B", "FT-Direct C(Non VAT)", "", "", ""],
                    ["TPRIO", "BP", "1", "Normal Priority", "", "", ""],
                    ["", "", "2", "Medium Priority", "", "", ""]
                ];
                var ws = X.utils.aoa_to_sheet(aoa);
                ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
                var wb = X.utils.book_new();
                X.utils.book_append_sheet(wb, ws, "ValueList");
                X.writeFile(wb, "ValueList_Upload_Template.xlsx");
            }).catch(function (e) {
                MessageBox.error(e.message || "Could not create the template.");
            });
        },

        onFileChange: function (oEvent) {
            var oUploader = oEvent.getSource();
            var aFiles = oEvent.getParameter("files");
            var oFile = aFiles && aFiles[0];
            if (!oFile) { return; }

            var oReader = new FileReader();
            oReader.onerror = function () { MessageBox.error("Could not read the file."); };
            oReader.onload = function (e) {
                this._loadXlsx()
                    .then(function (X) { return this._parseWorkbook(X, e.target.result); }.bind(this))
                    .then(function (aRows) { this._handleParsedRows(aRows, oFile.name); }.bind(this))
                    .catch(function (err) {
                        MessageBox.error("Could not read \u201c" + oFile.name + "\u201d: " + (err.message || "Unknown error"));
                    });
            }.bind(this);
            oReader.readAsArrayBuffer(oFile);
            oUploader.clear();
        },

        // Turns the first worksheet into [{table_name, area, field_value_1..5}].
        // Table / Area may be given only on the first row of each block (the
        // standard layout) — blank cells inherit the block's value, and a
        // completely empty row ends the block.
        _parseWorkbook: function (X, oBuffer) {
            var wb = X.read(oBuffer, { type: "array" });
            var ws = wb.Sheets[wb.SheetNames[0]];
            if (!ws) { throw new Error("The file has no worksheet."); }
            var aSheet = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

            var norm = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); };
            var iHeader = -1;
            var mCol = { table: 0, area: 1, fv: [2, 3, 4, 5, 6] };
            for (var r = 0; r < Math.min(aSheet.length, 10) && iHeader < 0; r++) {
                var aNorm = aSheet[r].map(norm);
                if (aNorm.indexOf("table") >= 0 && aNorm.indexOf("area") >= 0) {
                    iHeader = r;
                    mCol.table = aNorm.indexOf("table");
                    mCol.area = aNorm.indexOf("area");
                    for (var n = 1; n <= 5; n++) {
                        var i = aNorm.indexOf("fieldvalue" + n);
                        if (i < 0) { i = aNorm.indexOf("filledvalue" + n); }   // tolerate the typo in older sheets
                        if (i >= 0) { mCol.fv[n - 1] = i; }
                    }
                }
            }

            var aOut = [];
            var sTable = "", sArea = "";
            var cell = function (aRow, i) { return String(aRow[i] === undefined ? "" : aRow[i]).trim(); };
            for (var k = iHeader + 1; k < aSheet.length; k++) {
                var aRow = aSheet[k];
                var bEmpty = aRow.every(function (v) { return String(v).trim() === ""; });
                if (bEmpty) { sTable = ""; sArea = ""; continue; }

                var sT = cell(aRow, mCol.table);
                var sA = cell(aRow, mCol.area);
                if (sT) { sTable = sT; sArea = sA; }
                else if (sA) { sArea = sA; }

                var aFv = mCol.fv.map(function (i) { return cell(aRow, i); });
                if (!aFv.some(function (v) { return v; })) { continue; }

                aOut.push({
                    table_name   : sTable.toUpperCase(),
                    area         : sArea,
                    field_value_1: aFv[0],
                    field_value_2: aFv[1],
                    field_value_3: aFv[2],
                    field_value_4: aFv[3],
                    field_value_5: aFv[4]
                });
            }
            return aOut;
        },

        _handleParsedRows: function (aRows, sFileName) {
            if (!aRows.length) {
                MessageBox.warning("No data rows were found in \u201c" + sFileName + "\u201d.\n\n" +
                    "Expected columns: Table, Area, Field Value 1 \u2013 5.");
                return;
            }
            // Rows without any Table cannot be assigned to a value table.
            var iNoTable = aRows.filter(function (o) { return !o.table_name; }).length;
            aRows = aRows.filter(function (o) { return !!o.table_name; });
            if (!aRows.length) {
                MessageBox.error("None of the rows has a value in the Table column, so they cannot be assigned to a table.");
                return;
            }

            var mCount = {};
            aRows.forEach(function (o) { mCount[o.table_name] = (mCount[o.table_name] || 0) + 1; });
            var mExisting = {};
            (this.getView().getModel("sum").getProperty("/items") || []).forEach(function (o) {
                mExisting[o.table_name] = o.row_count;
            });
            var aTables = Object.keys(mCount);
            var bAnyExisting = aTables.some(function (t) { return mExisting[t]; });

            var aLines = aTables.slice(0, 15).map(function (t) {
                return "\u2022 " + t + ": " + mCount[t] + " row(s)" +
                    (mExisting[t] ? " (currently " + mExisting[t] + ")" : " (new)");
            });
            if (aTables.length > 15) { aLines.push("\u2022 \u2026 and " + (aTables.length - 15) + " more"); }
            var sMsg = aRows.length + " row(s) in " + aTables.length + " table(s) read from \u201c" + sFileName + "\u201d:\n\n" +
                aLines.join("\n") +
                (iNoTable ? "\n\n" + iNoTable + " row(s) without a Table value were skipped." : "");

            if (bAnyExisting) {
                MessageBox.show(sMsg + "\n\nSome of these tables already have data. Replace deletes the existing rows of the tables in this file first; Append adds after them.", {
                    icon   : MessageBox.Icon.QUESTION,
                    title  : "Upload Value List Data",
                    actions: ["Replace", "Append", MessageBox.Action.CANCEL],
                    emphasizedAction: "Replace",
                    onClose: function (sAction) {
                        if (sAction === "Replace" || sAction === "Append") {
                            this._upload(aRows, sAction.toUpperCase(), aTables[0]);
                        }
                    }.bind(this)
                });
            } else {
                MessageBox.confirm(sMsg + "\n\nUpload now?", {
                    title  : "Upload Value List Data",
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) { this._upload(aRows, "REPLACE", aTables[0]); }
                    }.bind(this)
                });
            }
        },

        _callUploadAction: function (sMode, aRows, aTables) {
            var oOp = this.getOwnerComponent().getModel().bindContext("/UploadValueList(...)");
            oOp.setParameter("mode", sMode);
            oOp.setParameter("rows", aRows);
            oOp.setParameter("tables", aTables);
            return oOp.execute("$direct").then(function () {
                return oOp.getBoundContext().getObject();
            });
        },

        _upload: function (aRows, sMode, sSelectTable) {
            this._oViewModel.setProperty("/busy", true);
            this._callUploadAction(sMode, aRows, [])
                .then(function (oRes) {
                    MessageToast.show((oRes && oRes.message) || (aRows.length + " row(s) uploaded."));
                    return this._loadSummary(sSelectTable);
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Upload failed: " + (e.message || "Unknown error"));
                })
                .then(function () { this._oViewModel.setProperty("/busy", false); }.bind(this));
        },

        // Start a new value table whose Backend Table is this uploaded table.
        onCreateValueTable: function (oEvent) {
            var sTable = oEvent.getSource().getBindingContext("sum").getProperty("table_name");
            this.getOwnerComponent().getRouter().navTo("valueTableDetail", {
                valueTableId: "NEW",
                "?query": { sourceTable: sTable }
            });
        },

        onClearTable: function (oEvent) {
            var sTable = oEvent.getSource().getBindingContext("sum").getProperty("table_name");
            MessageBox.confirm("Delete all uploaded data of table \u201c" + sTable + "\u201d?", {
                title  : "Delete Table Data",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    this._oViewModel.setProperty("/busy", true);
                    this._callUploadAction("CLEAR", [], [sTable])
                        .then(function () {
                            MessageToast.show("Data of " + sTable + " removed.");
                            return this._loadSummary();
                        }.bind(this))
                        .catch(function (e) {
                            MessageBox.error("Could not delete: " + (e.message || "Unknown error"));
                        })
                        .then(function () { this._oViewModel.setProperty("/busy", false); }.bind(this));
                }.bind(this)
            });
        }
    });
});