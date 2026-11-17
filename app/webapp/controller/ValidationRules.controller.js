sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/ActionSheet",
    "sap/m/Button",
    "mdm/portal/util/ColumnSettings"
], function (
    Controller, Filter, FilterOperator,
    JSONModel, MessageToast, MessageBox, ActionSheet, Button,
    ColumnSettings
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ValidationRules", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            var oUiModel = new JSONModel({
                totalCount  : 0,
                linkedCounts: {}    // { validationId: fieldCount }
            });
            this.getView().setModel(oUiModel, "ui");

            this._loadLinkedCounts();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("validationRules").attachPatternMatched(this._onRouteMatched, this);

            this._oColumnSettings = ColumnSettings(this, {
                storageKey: "mdmportal.validationRules.columnVisibility",
                columns: [
                    { id: "colFunction", label: "Function Name" },
                    { id: "colP1",       label: "Input Param 1" },
                    { id: "colP2",       label: "Input Param 2" },
                    { id: "colP3",       label: "Input Param 3" },
                    { id: "colTrigger",  label: "Trigger" },
                    { id: "colLinked",   label: "Linked Fields" }
                ]
            });
            this._oColumnSettings.init();
        },

        onColumnSettings: function () {
            this._oColumnSettings.open();
        },

        // ── Linked-field counts (fields per validation rule) ─────────
        _loadLinkedCounts: function () {
            var oModel   = this.getOwnerComponent().getModel();
            var oUiModel = this.getView().getModel("ui");
            oModel.bindList("/FieldMasters", null, null, null, {
                $select: "field_id,validation_validation_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oCounts = {};
                aCtx.forEach(function (c) {
                    var sVal = c.getProperty("validation_validation_id");
                    if (sVal) { oCounts[sVal] = (oCounts[sVal] || 0) + 1; }
                });
                oUiModel.setProperty("/linkedCounts", oCounts);
            }).catch(function () {});
        },

        _onRouteMatched: function () {
            var oTable = this.byId("ruleTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
                oBinding.refresh();
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("ruleTable").getBinding("items");
                    if (oB) { oB.attachEventOnce("dataReceived", this._onDataReceived, this); }
                }, this);
            }
        },

        _onDataReceived: function () {
            var oBinding = this.byId("ruleTable").getBinding("items");
            if (!oBinding) { return; }
            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    this.byId("tableTitle").setText("Validation Rules (" + (iTotal || 0) + ")");
                    this.getView().getModel("ui").setProperty("/totalCount", iTotal || 0);
                }.bind(this));
            }
            this._loadLinkedCounts();
        },

        // ── Formatters ───────────────────────────────────────────────
        formatTrigger: function (sTrigger) {
            if (sTrigger === "FIELD") { return "On Field Change"; }
            if (sTrigger === "SAVE")  { return "On Save"; }
            return sTrigger || "\u2014";
        },

        formatLinked: function (sValId, oCounts) {
            if (!sValId || !oCounts) { return "\u2014"; }
            var iCount = oCounts[sValId];
            if (iCount === undefined || iCount === null) { return "0 fields"; }
            return iCount + " field" + (iCount === 1 ? "" : "s");
        },

        // ── Filters ──────────────────────────────────────────────────
        onFilterLiveChange: function () { this._applyFilters(); },
        onFilterChange    : function () { this._applyFilters(); },
        onGo              : function () { this._applyFilters(); },

        _applyFilters: function () {
            var sSearch  = this.byId("filterSearch").getValue();
            var sTrigger = this.byId("filterTrigger").getSelectedKey();

            var aFilters = [];

            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter({ path: "validation_id", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false }),
                        new Filter({ path: "function_name", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false })
                    ],
                    and: false
                }));
            }
            if (sTrigger) {
                aFilters.push(new Filter("trigger_on", FilterOperator.EQ, sTrigger));
            }

            var oBinding = this.byId("ruleTable").getBinding("items");
            if (!oBinding) { return; }

            oBinding.filter(
                aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []
            );
            oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
        },

        onClearFilters: function () {
            this.byId("filterSearch").setValue("");
            this.byId("filterTrigger").setSelectedKey("");
            var oBinding = this.byId("ruleTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            }
        },

        // ── Multi-select toolbar ─────────────────────────────────────
        onSelectionChange: function () {
            var bHas = this.byId("ruleTable").getSelectedItems().length > 0;
            this.byId("bulkDeleteBtn").setVisible(bHas);
            this.byId("bulkSeparator").setVisible(bHas);
        },

        // Rules that are still linked to fields cannot be deleted. The server
        // enforces this too; checking here lets us explain it up front and
        // still delete the rules that are free.
        _splitByLinks: function (aCtx) {
            var oCounts = this.getView().getModel("ui").getProperty("/linkedCounts") || {};
            var aFree = [], aBlocked = [];
            aCtx.forEach(function (oCtx) {
                var sId = oCtx.getProperty("validation_id");
                if (oCounts[sId]) { aBlocked.push(sId + " (" + oCounts[sId] + " field" + (oCounts[sId] > 1 ? "s" : "") + ")"); }
                else { aFree.push(oCtx); }
            });
            return { free: aFree, blocked: aBlocked };
        },

        _deleteRules: function (aCtx) {
            var o = this._splitByLinks(aCtx);
            var sBlocked = o.blocked.length
                ? "Cannot delete (still linked to fields): " + o.blocked.join(", ") + ". Remove the rule from those fields first."
                : "";
            if (!o.free.length) { MessageBox.error(sBlocked); return; }
            MessageBox.confirm(
                "Delete " + o.free.length + " validation rule(s)? This cannot be undone." +
                (sBlocked ? "\n\n" + sBlocked : ""), {
                title  : "Confirm Deletion",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    Promise.all(o.free.map(function (oCtx) { return oCtx.delete("$auto"); }))
                        .then(function () {
                            MessageToast.show("Deleted successfully.");
                            this._loadLinkedCounts();
                        }.bind(this))
                        .catch(function (e) { MessageBox.error("Delete failed: " + e.message); });
                }.bind(this)
            });
        },

        onBulkDelete: function () {
            var aSelected = this.byId("ruleTable").getSelectedItems();
            if (!aSelected.length) { return; }
            this._deleteRules(aSelected.map(function (i) { return i.getBindingContext(); }));
        },

        // ── Row context menu ─────────────────────────────────────────
        onRowMenuPress: function (oEvent) {
            var oButton = oEvent.getSource();
            this._oMenuCtx = oButton.getBindingContext();

            if (!this._oActionSheet) {
                this._oActionSheet = new ActionSheet({
                    buttons: [
                        new Button({ text: "Edit",      icon: "sap-icon://edit", press: this._onMenuEdit.bind(this) }),
                        new Button({ text: "Duplicate", icon: "sap-icon://copy", press: function () { MessageToast.show("Duplicate — coming soon"); } }),
                        new Button({ text: "Delete",    icon: "sap-icon://delete", press: this._onMenuDelete.bind(this) })
                    ]
                });
                this.getView().addDependent(this._oActionSheet);
            }
            this._oActionSheet.openBy(oButton);
        },

        _onMenuEdit: function () {
            var sId = this._oMenuCtx.getProperty("validation_id");
            this.getOwnerComponent().getRouter().navTo("validationRuleDetail", {
                validationId: encodeURIComponent(sId.toLowerCase())
            });
        },

        _onMenuDelete: function () {
            this._deleteRules([this._oMenuCtx]);
        },

        // ── Navigation ───────────────────────────────────────────────
        onLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("validation_id");
            this.getOwnerComponent().getRouter().navTo("validationRuleDetail", {
                validationId: encodeURIComponent(sId.toLowerCase())
            });
        },

        onRowPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("validation_id");
            this.getOwnerComponent().getRouter().navTo("validationRuleDetail", {
                validationId: encodeURIComponent(sId.toLowerCase())
            });
        },

        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("validationRuleDetail", { validationId: "NEW" });
        },

        // ── Export ───────────────────────────────────────────────────
        onExport: function () {
            var oBinding = this.byId("ruleTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var oCounts = this.getView().getModel("ui").getProperty("/linkedCounts") || {};
                var aData = aCtx.map(function (oCtx) {
                    return {
                        "Validation Name": oCtx.getProperty("validation_id"),
                        "Function Name": oCtx.getProperty("function_name"),
                        "Description"  : oCtx.getProperty("description"),
                        "Input Param 1": oCtx.getProperty("input_param_1") || "",
                        "Input Param 2": oCtx.getProperty("input_param_2") || "",
                        "Input Param 3": oCtx.getProperty("input_param_3") || "",
                        "Trigger"      : this.formatTrigger(oCtx.getProperty("trigger_on")),
                        "Error Message": oCtx.getProperty("error_message"),
                        "Linked Fields": oCounts[oCtx.getProperty("validation_id")] || 0
                    };
                }.bind(this));
                this._downloadCSV(aData, "validation-rules.csv");
            }.bind(this)).catch(function (e) {
                MessageBox.error("Export failed: " + e.message);
            });
        },

        _downloadCSV: function (aData, sFilename) {
            if (!aData || !aData.length) { MessageToast.show("No data to export."); return; }
            var aKeys = Object.keys(aData[0]);
            var sCSV  = aKeys.join(",") + "\n" +
                aData.map(function (r) {
                    return aKeys.map(function (k) {
                        return '"' + String(r[k] !== undefined ? r[k] : "").replace(/"/g, '""') + '"';
                    }).join(",");
                }).join("\n");
            var oBlob = new Blob(["\ufeff" + sCSV], { type: "text/csv;charset=utf-8;" });
            var sUrl  = URL.createObjectURL(oBlob);
            var oLink = document.createElement("a");
            oLink.href = sUrl; oLink.download = sFilename; oLink.click();
            URL.revokeObjectURL(sUrl);
        }
    });
});