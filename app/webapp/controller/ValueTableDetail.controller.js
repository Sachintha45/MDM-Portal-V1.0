sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, DateFormat
) {
    "use strict";

    var oDateFmt = DateFormat.getDateTimeInstance({ style: "medium" });

    return Controller.extend("mdm.portal.controller.ValueTableDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy        : false,
                isNew       : false,
                isDirty     : false,
                selectedTab : "general",
                usageCount  : "0",
                entriesCount: "0",
                entriesInfo : ""
            });
            this.getView().setModel(this._oViewModel, "view");

            // Usage list held in a JSON model (loaded on demand)
            this.getView().setModel(new JSONModel({ items: [] }), "usage");
            // Read-only rows from the Value List Upload page, matched on the
            // Backend Table (source_table) of this value table.
            this.getView().setModel(new JSONModel({ items: [] }), "entries");
            // Tables already uploaded on the Value List Upload page — offered
            // in the Backend Table dropdown (typing any other name still works).
            this.getView().setModel(new JSONModel({ items: [] }), "uploaded");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("valueTableDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var sRaw = decodeURIComponent(oEvent.getParameter("arguments").valueTableId);
            var sId = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();

            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("usage").setProperty("/items", []);
            this._oViewModel.setProperty("/usageCount", "0");
            this.getView().getModel("entries").setProperty("/items", []);
            this._oViewModel.setProperty("/entriesCount", "0");

            this._loadUploadedTables();

            if (sId === "NEW") {
                this._createNew();
                // Opened from the Value List Upload page ("Create Value Table"):
                // start the new value table from that uploaded table.
                var oQuery = oEvent.getParameter("arguments")["?query"] || {};
                var sTable = (oQuery.sourceTable || "").trim().toUpperCase();
                if (sTable) {
                    var oCtx = this.getView().getBindingContext();
                    if (oCtx) {
                        oCtx.setProperty("source_table", sTable);
                        oCtx.setProperty("value_table_id", "VT_" + sTable);
                    }
                    this.byId("inId").setValue("VT_" + sTable);
                    this._oViewModel.setProperty("/isDirty", true);
                    this._loadEntries();
                }
            } else {
                this._bindValueTable(sId);
            }
        },

        // ── Uploaded tables for the Backend Table dropdown ──────────
        _loadUploadedTables: function () {
            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/ValueListSummary", null, [new Sorter("table_name")], [], {
                $select: "table_name,row_count"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                this.getView().getModel("uploaded").setProperty("/items", aCtx.map(function (c) {
                    return { table_name: c.getProperty("table_name"), row_count: c.getProperty("row_count") };
                }));
            }.bind(this)).catch(function () {
                // the dropdown is only a convenience — typing a name still works
            });
        },

        onSourceTableChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
            this._loadEntries();
        },

        // ── Bind existing ────────────────────────────────────────────
        _bindValueTable: function (sId) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            var sPath = "/ValueTables('" + sId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    $select: "value_table_id,description,source_table,input_1,input_2,input_3," +
                             "output_key,output_desc,status",
                    $$updateGroupId: "valueTableUpdate"
                },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load value table: " + (oError.message || "Unknown error"));
                            return;
                        }

                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Value table not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                            // Load usage count eagerly, right when the record loads
                            // — not lazily on tab-select.
                            this._loadUsage();
                            this._loadEntries();
                        }.bind(this));
                        // ID is the key — not editable on existing record
                        this.byId("inId").setEditable(false);
                    }.bind(this)
                }
            });
        },

        // ── Create new ───────────────────────────────────────────────
        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  false);

            var oModel = this.getOwnerComponent().getModel();
            // Bind list to the SAME update group submitBatch uses
            var oListBinding = oModel.bindList("/ValueTables", null, [], [], {
                $$updateGroupId: "valueTableUpdate"
            });
            var oContext = oListBinding.create({
                value_table_id: "",
                description   : "",
                source_table  : "",
                input_1       : null,
                input_2       : null,
                input_3       : null,
                output_key    : "field_value_1",
                output_desc   : "field_value_2",
                status        : "ACTIVE"
            });
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            this._refreshHeader({ value_table_id: "", description: "", status: "ACTIVE" });
            this.byId("inId").setEditable(true);
        },

        // ── Header refresh ────────────────────────────────────────────
        _refreshHeader: function (oData) {
            var sId   = oData.value_table_id || "";
            var sDesc = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " — " + sDesc : "")) : "New Value Table";

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) {
                oBreadcrumb.setCurrentLocationText(sId || "New Value Table");
            }

            var bActive = oData.status === "ACTIVE";

            var oSubtitle = this.byId("pageSubtitle");
            if (oSubtitle) {
                oSubtitle.setText(
                    "Value table" + (oData.source_table ? " · source " + oData.source_table : "")
                );
            }
            var oAttrStatus = this.byId("attrStatus");
            if (oAttrStatus) {
                oAttrStatus.setText(bActive ? "Active" : "Inactive");
                oAttrStatus.setState(bActive ? "Success" : "Error");
            }
            var oAttrSource = this.byId("attrSource");
            if (oAttrSource) { oAttrSource.setText(oData.source_table || "—"); }

            // The Switch's state is normally driven by the expression binding
            // {= ${status} === 'ACTIVE'} in the view, but OData V4's automatic
            // $select detection doesn't reliably pick up properties that are
            // only referenced inside an expression binding, so on initial load
            // "status" can remain unfetched for this control specifically even
            // though it's already resolved here. Set it explicitly so the
            // switch is always correct regardless of that timing quirk.
            var oSwStatus = this.byId("swStatus");
            if (oSwStatus) { oSwStatus.setState(bActive); }
        },

        // ── Dirty flag ───────────────────────────────────────────────
        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        onStatusChange: function (oEvent) {
            // Write the new status straight into the bound context so the
            // (read-only) expression binding stays in sync and the value is
            // actually part of the pending changes when Save runs.
            var bOn  = oEvent.getParameter("state");
            var oCtx = this.getView().getBindingContext();
            if (oCtx) {
                oCtx.setProperty("status", bOn ? "ACTIVE" : "INACTIVE");
            }
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "usage")     { this._loadUsage(); }
            if (sKey === "entries")   { this._loadEntries(); }
            if (sKey === "changelog") { this._loadChangeLog(); }
        },

        // ── Usage tab ────────────────────────────────────────────────
        _loadUsage: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("value_table_id");
            if (!sId) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/FieldMasters", null, [new Sorter("field_id")], [
                new Filter("value_table_value_table_id", FilterOperator.EQ, sId)
            ], {
                $select: "field_id,description,display_type,active,main_group_group_id,sub_group_group_id,value_table_value_table_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aItems = aCtx.map(function (c) {
                    return {
                        field_id    : c.getProperty("field_id"),
                        description : c.getProperty("description"),
                        display_type: c.getProperty("display_type"),
                        main_group  : c.getProperty("main_group_group_id"),
                        sub_group   : c.getProperty("sub_group_group_id"),
                        active      : c.getProperty("active")
                    };
                });
                this.getView().getModel("usage").setProperty("/items", aItems);
                this._oViewModel.setProperty("/usageCount", String(aItems.length));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load usage: " + e.message);
            });
        },

        onUsageRowPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("usage").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(sFieldId.toLowerCase())
            });
        },

        onUsageLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("usage").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(sFieldId.toLowerCase())
            });
        },

        // ── Change log tab ───────────────────────────────────────────
        _loadChangeLog: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("value_table_id");
            if (!sId) { return; }

            var oTable   = this.byId("logTable");
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([
                new Filter("entity_name", FilterOperator.EQ, "ValueTable"),
                new Filter("entity_key",  FilterOperator.EQ, sId)
            ]);
            oBinding.resume();
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId         = this.byId("inId").getValue().trim().toUpperCase();
            var sDesc       = this.byId("inDescription").getValue().trim();
            var sSource     = this.byId("inSourceTable").getValue().trim();
            var sOutputKey  = this.byId("inOutputKey").getSelectedKey();
            var sOutputDesc = this.byId("inOutputDesc").getSelectedKey();

            // Validation
            if (!sId) {
                MessageBox.error("Value Table Name is required.");
                return;
            }
            if (!/^[A-Z0-9_]+$/.test(sId)) {
                MessageBox.error("Value Table Name must be uppercase letters, numbers, and underscores only.");
                return;
            }
            if (!sDesc) {
                MessageBox.error("Description is required.");
                return;
            }
            if (!sSource) {
                MessageBox.error("Source Table is required.");
                return;
            }
            if (!sOutputKey) {
                MessageBox.error("Select the Output Key column (Output Columns tab).");
                this.byId("detailTabs").setSelectedKey("output");
                return;
            }
            if (!sOutputDesc) {
                MessageBox.error("Select the Output Description column (Output Columns tab).");
                this.byId("detailTabs").setSelectedKey("output");
                return;
            }

            this._oViewModel.setProperty("/busy", true);

            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                // description, source_table, output_*, input_* are two-way bound,
                // so they are already pending. Only handle the key + status here.
                if (bIsNew) {
                    oCtx.setProperty("value_table_id", sId);
                }
                // status comes from the Switch (not directly bound to a string)
                oCtx.setProperty("status",
                    this.byId("swStatus").getState() ? "ACTIVE" : "INACTIVE");
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("valueTableUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Value table saved successfully.");

                    if (bWasCreated) {
                        // Delay slightly so the toast actually paints before the
                        // route change tears the page down.
                        this._oCreateListBinding = null;
                        setTimeout(this.onNavBack.bind(this), 300);
                    } else if (oCtx) {
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }
                }.bind(this))
                .catch(function (oErr) {
                    this._oViewModel.setProperty("/busy", false);
                    var sMsg = oErr && oErr.message ? oErr.message : "Unknown error";
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("valueTableUpdate");
                this._oViewModel.setProperty("/isDirty", false);
                this.onNavBack();
            }.bind(this);

            if (this._oViewModel.getProperty("/isDirty")) {
                MessageBox.confirm("Discard unsaved changes?", {
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) { fnGoBack(); }
                    }
                });
            } else {
                fnGoBack();
            }
        },

        // ── Copy ─────────────────────────────────────────────────────
        onCopy: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) {
                MessageToast.show("No value table selected to copy.");
                return;
            }
            this.getOwnerComponent().getModel().resetChanges("valueTableUpdate");
            oCtx.requestObject().then(function (oData) {
                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/ValueTables", null, [], [], {
                    $$updateGroupId: "valueTableUpdate"
                });
                var oNewCtx = oListBinding.create({
                    value_table_id: "",
                    description   : oData.description + " (Copy)",
                    source_table  : oData.source_table,
                    input_1       : oData.input_1,
                    input_2       : oData.input_2,
                    input_3       : oData.input_3,
                    output_key    : oData.output_key,
                    output_desc   : oData.output_desc,
                    status        : "INACTIVE"
                });
                this._oCreateListBinding = oListBinding;
                // Unbind the source record's object binding (set by the _bind* view
                // binding) before switching context; an object binding overrides
                // setBindingContext, otherwise the copy never appears.
                this.getView().unbindObject();
                this.getView().setBindingContext(oNewCtx);
                this._oViewModel.setProperty("/isNew",   true);
                this._oViewModel.setProperty("/isDirty", true);
                this.byId("inId").setEditable(true);

                this._refreshHeader({
                    value_table_id: "",
                    description   : oData.description + " (Copy)",
                    source_table  : oData.source_table,
                    status        : "INACTIVE"
                });

                this.byId("detailTabs").setSelectedKey("general");
                MessageToast.show("Value table copied — enter a new Value Table Name and press Save.");
            }.bind(this));
        },

        // ── Value List Data tab (read-only) ──────────────────────────
        // Shows the uploaded rows whose Table equals this value table's
        // Backend Table. The data itself is loaded on the Value List Upload page.
        _loadEntries: function () {
            var oInput = this.byId("inSourceTable");
            var sSource = ((oInput && oInput.getValue()) || "").trim().toUpperCase();
            var oEntries = this.getView().getModel("entries");

            if (!sSource) {
                oEntries.setProperty("/items", []);
                this._oViewModel.setProperty("/entriesCount", "0");
                this._oViewModel.setProperty("/entriesInfo", "Enter a Backend Table on the General tab to see its value list data.");
                return Promise.resolve();
            }
            var oModel = this.getOwnerComponent().getModel();
            return oModel.bindList("/ValueListEntries", null, [new Sorter("line_no")], [
                new Filter("table_name", FilterOperator.EQ, sSource)
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
                oEntries.setProperty("/items", aItems);
                this._oViewModel.setProperty("/entriesCount", String(aItems.length));
                this._oViewModel.setProperty("/entriesInfo", aItems.length
                    ? "Showing the uploaded rows of table " + sSource + ". Key = " +
                      this._colLabel(this.byId("inOutputKey").getSelectedKey()) + ", Description = " +
                      this._colLabel(this.byId("inOutputDesc").getSelectedKey()) +
                      ". To change the data, use the Value List Upload page."
                    : "No uploaded data found for table " + sSource + ". Upload a file on the Value List Upload page with this table name in the Table column.");
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load value list data: " + (e.message || "Unknown error"));
            });
        },

        _colLabel: function (sKey) {
            var m = { area: "Area", field_value_1: "Field Value 1", field_value_2: "Field Value 2",
                      field_value_3: "Field Value 3", field_value_4: "Field Value 4", field_value_5: "Field Value 5" };
            return m[sKey] || sKey || "(not set)";
        },

        // Output Key / Description changed: mark dirty and refresh the hint
        // on the Value List Data tab.
        onOutputColumnChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
            this._loadEntries();
        },

        onEntriesSearch: function (oEvent) {
            var sQuery = (oEvent.getParameter("newValue") || "").trim();
            var oBinding = this.byId("entriesTable").getBinding("items");
            if (!oBinding) { return; }
            if (!sQuery) { oBinding.filter([]); return; }
            var aFields = ["area", "field_value_1", "field_value_2", "field_value_3", "field_value_4", "field_value_5"];
            oBinding.filter(new Filter({
                filters: aFields.map(function (f) { return new Filter(f, FilterOperator.Contains, sQuery); }),
                and: false
            }));
        },

        onOpenUploadPage: function () {
            this.getOwnerComponent().getRouter().navTo("valueListUpload");
        },

        // ── Test Query ───────────────────────────────────────────────
        onTestQuery: function () {
            var sSource     = this.byId("inSourceTable").getValue().trim();
            var sOutputKey  = this.byId("inOutputKey").getSelectedKey();
            var sOutputDesc = this.byId("inOutputDesc").getSelectedKey();

            if (!sSource) {
                MessageBox.warning("Enter a Backend Table before testing the query.");
                return;
            }
            if (!sOutputKey || !sOutputDesc) {
                MessageBox.warning("Output Key and Output Description are required to test the query (Output Columns tab).");
                this.byId("detailTabs").setSelectedKey("output");
                return;
            }
            // In a real system this would call a backend action to run a sample
            // query against sSource. Here we surface the would-be query for review.
            MessageBox.information(
                "Sample query prepared:\n\n" +
                "SELECT " + sOutputKey + " AS key, " + sOutputDesc + " AS text\n" +
                "FROM ValueListEntry\n" +
                "WHERE table_name = '" + sSource.toUpperCase() + "'\n\n" +
                "Key = " + this._colLabel(sOutputKey) + ", Description = " + this._colLabel(sOutputDesc) + ".",
                { title: "Test Query" }
            );
        },

        // ── Backend table value help ─────────────────────────────────
        // Lists the tables that have been uploaded on the Value List Upload
        // page, so the Backend Table always matches the uploaded Table name.
        onSourceTableValueHelp: function () {
            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/ValueListSummary", null, [new Sorter("table_name")], [], {
                $select: "table_name,row_count"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                if (!aCtx.length) {
                    MessageToast.show("No tables uploaded yet \u2014 use Value List Upload first, or type the table name.");
                    return;
                }
                var aItems = aCtx.map(function (c) {
                    return { table_name: c.getProperty("table_name"), row_count: c.getProperty("row_count") };
                });
                sap.ui.require(["sap/m/SelectDialog", "sap/m/StandardListItem"], function (SelectDialog, StandardListItem) {
                    var oDialog = new SelectDialog({
                        title: "Select Backend Table",
                        items: {
                            path: "vh>/items",
                            template: new StandardListItem({
                                title: "{vh>table_name}",
                                description: "{vh>row_count} uploaded row(s)"
                            })
                        },
                        search: function (oEvt) {
                            var sVal = oEvt.getParameter("value");
                            oEvt.getSource().getBinding("items").filter(
                                sVal ? [new Filter("table_name", FilterOperator.Contains, sVal.toUpperCase())] : []);
                        },
                        confirm: function (oEvt) {
                            var oItem = oEvt.getParameter("selectedItem");
                            if (!oItem) { return; }
                            this.byId("inSourceTable").setValue(oItem.getTitle());
                            this._oViewModel.setProperty("/isDirty", true);
                            this._loadEntries();
                        }.bind(this),
                        cancel: function () { },
                        afterClose: function () { oDialog.destroy(); }
                    });
                    oDialog.setModel(new JSONModel({ items: aItems }), "vh");
                    this.getView().addDependent(oDialog);
                    oDialog.open();
                }.bind(this));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load uploaded tables: " + (e.message || "Unknown error"));
            });
        },

        // ── Navigation ───────────────────────────────────────────────
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("valueTables");
        }
    });
});