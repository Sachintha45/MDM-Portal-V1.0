sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/List",
    "sap/m/SearchField",
    "sap/m/StandardListItem"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, Dialog, Button, List, SearchField, StandardListItem
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ValidationRuleDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy        : false,
                isNew       : false,
                isDirty     : false,
                selectedTab : "general",
                usageCount  : "0"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [], saved: [], add: [], remove: [] }), "usage");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("validationRuleDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var sRaw = decodeURIComponent(oEvent.getParameter("arguments").validationId);
            var sId = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();

            this._mTyped = {};
            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this._oViewModel.setProperty("/usageCount", "0");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("usage").setData({ items: [], saved: [], add: [], remove: [] });
            var oAttrUsage = this.byId("attrUsage");
            if (oAttrUsage) { oAttrUsage.setText(""); }

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindRule(sId);
            }
        },

        // ── Bind existing ────────────────────────────────────────────
        _bindRule: function (sId) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            var sPath = "/ValidationRules('" + sId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: { $$updateGroupId: "validationUpdate" },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load validation rule: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Validation rule not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);
                            // Load usage count eagerly, right when the record loads
                            // — not lazily on tab-select.
                            this._loadUsage();
                        }.bind(this));
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
            var oListBinding = oModel.bindList("/ValidationRules", null, [], [], {
                $$updateGroupId: "validationUpdate"
            });
            var oContext = oListBinding.create({
                validation_id : "",
                description   : "",
                function_name : "",
                input_param_1 : null,
                input_param_2 : null,
                input_param_3 : null,
                trigger_on    : "FIELD",
                error_message : ""
            });
            this._oCreateListBinding = oListBinding;
            // detach the previously opened rule, otherwise its element binding
            // keeps feeding old values into the "new" form
            this.getView().unbindObject();
            this.getView().setBindingContext(oContext);
            this._refreshHeader({ validation_id: "", function_name: "", trigger_on: "FIELD" });
            this.byId("inId").setEditable(true);
            // Trigger is bound to the record (default FIELD) — do not also set
            // it on the control: that writes to the new record before the
            // binding has read it ("Must not change a property before it has
            // been read") and leaves the save waiting.
        },

        // ── Header refresh ────────────────────────────────────────────
        _refreshHeader: function (oData) {
            var sId = oData.validation_id || "";
            var sFn = oData.function_name || "";
            var sTitle = sId ? (sId + (sFn ? " — " + sFn : "")) : "New Validation Rule";

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) {
                oBreadcrumb.setCurrentLocationText(sId || "New Validation Rule");
            }
            var oSubtitle = this.byId("pageSubtitle");
            if (oSubtitle) { oSubtitle.setText("Validation Rule"); }

            var sTrigger = oData.trigger_on === "SAVE" ? "On Save" :
                           oData.trigger_on === "FIELD" ? "On Field Change" : "\u2014";
            var oAttrTrigger = this.byId("attrTrigger");
            if (oAttrTrigger) { oAttrTrigger.setText(sTrigger); }
        },

        // ── Dirty flag ───────────────────────────────────────────────
        // Keep a copy of what the user typed in each box. The boxes live on
        // different tabs; if one is re-read from the record when you come back
        // from another tab it can show (and save) as empty, so Save falls back
        // to this copy.
        onFieldChange: function (oEvent) {
            this._oViewModel.setProperty("/isDirty", true);
            var oSrc = oEvent && oEvent.getSource && oEvent.getSource();
            var sVal = oEvent && oEvent.getParameter && oEvent.getParameter("value");
            if (oSrc && sVal !== undefined) {
                this._mTyped = this._mTyped || {};
                this._mTyped[oSrc.getId().split("--").pop()] = sVal;
            }
        },

        // text of a form box: what is on screen, else what was typed, else the record
        _formValue: function (sControlId, sProp) {
            var o = this.byId(sControlId);
            var v = o && o.getValue ? o.getValue() : "";
            if (!v && this._mTyped) { v = this._mTyped[sControlId] || ""; }
            if (!v) {
                var oCtx = this.getView().getBindingContext();
                v = (oCtx && oCtx.getProperty(sProp)) || "";
            }
            return String(v).trim();
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "usage") { this._loadUsage(); }
        },

        // ── Linked Fields tab ────────────────────────────────────────
        _loadUsage: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("validation_id");
            if (!sId) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/FieldMasters", null, [new Sorter("field_id")], [
                new Filter("validation_validation_id", FilterOperator.EQ, sId)
            ], {
                $select: "field_id,description,data_type,active,main_group_group_id,sub_group_group_id,validation_validation_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                // Guard against the view (or this control specifically) having
                // been torn down while this async request was in flight — e.g.
                // the user navigated away or switched to a different rule
                // right after selecting this tab. Without this check,
                // this.byId("attrUsage") can return undefined here and crash
                // with "Cannot read properties of undefined (reading 'setText')".
                var oView = this.getView();
                if (!oView || oView.bIsDestroyed) { return; }

                var aItems = aCtx.map(function (c) {
                    return {
                        field_id    : c.getProperty("field_id"),
                        description : c.getProperty("description"),
                        data_type   : c.getProperty("data_type"),
                        main_group  : c.getProperty("main_group_group_id"),
                        sub_group   : c.getProperty("sub_group_group_id"),
                        active      : c.getProperty("active")
                    };
                });
                oView.getModel("usage").setProperty("/saved", aItems);
                this._refreshUsageRows();
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load linked fields: " + e.message);
            });
        },

        // Linked fields = saved links, minus staged removals, plus staged
        // additions. Staged changes are written when the rule is saved, so
        // fields can be assigned while the rule is still being created.
        _refreshUsageRows: function () {
            var oM = this.getView().getModel("usage");
            var aRemove = oM.getProperty("/remove") || [];
            var aRows = (oM.getProperty("/saved") || [])
                .filter(function (r) { return aRemove.indexOf(r.field_id) < 0; })
                .map(function (r) { return Object.assign({}, r, { pending: false }); })
                .concat((oM.getProperty("/add") || []).map(function (r) {
                    return Object.assign({}, r, { pending: true });
                }));
            oM.setProperty("/items", aRows);
            this._oViewModel.setProperty("/usageCount", String(aRows.length));
            var oAttrUsage = this.byId("attrUsage");
            if (oAttrUsage) {
                oAttrUsage.setText(aRows.length + " field" + (aRows.length !== 1 ? "s" : ""));
            }
        },

        // same data-type rules as the Field Master Validation tab
        _VALIDATION_TYPES: {
            checkNumeric:     ["INTEGER", "DECIMAL"],
            checkEmailFormat: ["STRING"],
            checkDateRange:   ["DATE"],
            checkMaxLength:   ["STRING"]
        },

        onAssignFields: function () {
            var oM = this.getView().getModel("usage");
            var sFn = this._formValue("inFunction", "function_name");
            var aTypes = this._VALIDATION_TYPES[sFn];
            var aTaken = (oM.getProperty("/items") || []).map(function (r) { return r.field_id; });

            this.getView().getModel().bindList("/FieldMasters", null, [new Sorter("field_id")], [], {
                $select: "field_id,description,data_type,active,main_group_group_id,sub_group_group_id,validation_validation_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aFields = aCtx.map(function (c) {
                    return {
                        field_id    : c.getProperty("field_id"),
                        description : c.getProperty("description") || "",
                        data_type   : c.getProperty("data_type"),
                        main_group  : c.getProperty("main_group_group_id"),
                        sub_group   : c.getProperty("sub_group_group_id"),
                        active      : c.getProperty("active"),
                        other_rule  : c.getProperty("validation_validation_id")
                    };
                }).filter(function (f) {
                    return aTaken.indexOf(f.field_id) < 0 && (!aTypes || aTypes.indexOf(f.data_type) >= 0);
                });
                this._openAssignDialog(aFields, sFn, aTypes);
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load fields: " + e.message);
            });
        },

        _openAssignDialog: function (aFields, sFn, aTypes) {
            var oList = new List({
                mode: "MultiSelect", includeItemInSelection: true, growing: true, growingThreshold: 50,
                noDataText: "No matching fields available."
            });
            aFields.forEach(function (f) {
                var oItem = new StandardListItem({
                    title: f.field_id,
                    description: f.description + " \u00b7 " + f.data_type +
                        (f.other_rule ? " \u00b7 currently uses " + f.other_rule : "")
                });
                oItem.data("field", f);
                oList.addItem(oItem);
            });
            var oSearch = new SearchField({
                placeholder: "Search fields\u2026",
                liveChange: function (oEv) {
                    var q = (oEv.getParameter("newValue") || "").toLowerCase();
                    oList.getItems().forEach(function (it) {
                        it.setVisible(!q || (it.getTitle() + " " + it.getDescription()).toLowerCase().indexOf(q) >= 0);
                    });
                }
            });
            var oDlg = new Dialog({
                title: "Assign Fields",
                contentWidth: "36rem",
                contentHeight: "26rem",
                content: [oSearch, oList],
                beginButton: new Button({
                    text: "Assign", type: "Emphasized",
                    press: function () {
                        var oM = this.getView().getModel("usage");
                        var aAdd = (oM.getProperty("/add") || []).slice();
                        oList.getSelectedItems().forEach(function (it) {
                            var f = it.data("field");
                            // re-adding a field removed earlier just cancels the removal
                            var aRem = oM.getProperty("/remove") || [];
                            var i = aRem.indexOf(f.field_id);
                            if (i >= 0) { aRem.splice(i, 1); oM.setProperty("/remove", aRem); }
                            else { aAdd.push(f); }
                        });
                        oM.setProperty("/add", aAdd);
                        this._refreshUsageRows();
                        this._oViewModel.setProperty("/isDirty", true);
                        oDlg.close();
                    }.bind(this)
                }),
                endButton: new Button({ text: "Cancel", press: function () { oDlg.close(); } }),
                afterClose: function () { oDlg.destroy(); }
            });
            if (aTypes) {
                oDlg.setSubHeader(new sap.m.Toolbar({ content: [new sap.m.Text({
                    text: "Showing " + aTypes.join(" / ") + " fields \u2014 the data types " + sFn + " can check."
                })] }));
            }
            this.getView().addDependent(oDlg);
            oDlg.open();
        },

        onUsageRemove: function (oEvent) {
            var oM = this.getView().getModel("usage");
            var o = oEvent.getSource().getBindingContext("usage").getObject();
            if (o.pending) {
                oM.setProperty("/add", (oM.getProperty("/add") || []).filter(function (r) { return r.field_id !== o.field_id; }));
            } else {
                var aRem = (oM.getProperty("/remove") || []).slice();
                aRem.push(o.field_id);
                oM.setProperty("/remove", aRem);
            }
            this._refreshUsageRows();
            this._oViewModel.setProperty("/isDirty", true);
        },

        // Writes the staged links once the rule itself exists.
        _saveLinks: function (sRuleId) {
            var oM = this.getView().getModel("usage");
            var oModel = this.getOwnerComponent().getModel();
            var aChanges = (oM.getProperty("/add") || []).map(function (r) { return { id: r.field_id, val: sRuleId }; })
                .concat((oM.getProperty("/remove") || []).map(function (id) { return { id: id, val: null }; }));
            if (!aChanges.length) { return Promise.resolve(); }
            var sGrp = "validationLinks";
            var aBindings = [];
            var aPatches = [];
            return Promise.all(aChanges.map(function (c) {
                var oB = oModel.bindContext("/FieldMasters('" + c.id + "')", null, { $$updateGroupId: sGrp });
                aBindings.push(oB);
                return oB.requestObject().then(function () {
                    // Do NOT wait for this promise here: for a manual update
                    // group it only resolves once the batch has been sent,
                    // and the batch is sent below — waiting would hang the save.
                    aPatches.push(oB.getBoundContext().setProperty("validation_validation_id", c.val, sGrp));
                });
            })).then(function () {
                var pSubmit = oModel.submitBatch(sGrp);
                return Promise.all([pSubmit].concat(aPatches));
            }).then(function () {
                oM.setProperty("/add", []);
                oM.setProperty("/remove", []);
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

        // ── Function value help (stub) ───────────────────────────────
        onFunctionValueHelp: function () {
            MessageToast.show("Function search help — connect to the published CAP validation functions.");
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId      = this.byId("inId").getValue().trim().toUpperCase();
            var sFn      = this._formValue("inFunction", "function_name");
            var sErrMsg  = this._formValue("inErrorMessage", "error_message");
            var oCtxT    = this.getView().getBindingContext();
            var sTrigger = this.byId("selTrigger").getSelectedKey() ||
                           (oCtxT && oCtxT.getProperty("trigger_on")) || "";

            if (!sId) {
                MessageBox.error("Validation Name is required.");
                return;
            }
            if (!/^[A-Z0-9_]+$/.test(sId)) {
                MessageBox.error("Validation Name must be uppercase letters, numbers, and underscores only.");
                return;
            }
            if (!sFn) {
                MessageBox.error("Function Name is required.");
                return;
            }
            if (!sTrigger) {
                MessageBox.error("Trigger is required.");
                return;
            }
            if (!sErrMsg) {
                MessageBox.error("Error Message is required.");
                return;
            }

            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oInId  = this.byId("inId");

            // Authoritative duplicate check — also runs if the user never left
            // the Validation Name box before pressing Save.
            (bIsNew ? this._idExists(sId) : Promise.resolve(false)).then(function (bExists) {
                if (bExists) {
                    oInId.setValueState("Error");
                    oInId.setValueStateText("Validation Name \"" + sId + "\" already exists.");
                    MessageBox.error("Validation Name \"" + sId + "\" already exists. Choose a different name.");
                    return;
                }
                this._doSave(sId, sTrigger, bIsNew);
            }.bind(this)).catch(function () {
                // could not check — let the server's own constraint decide
                this._doSave(sId, sTrigger, bIsNew);
            }.bind(this));
        },

        _idExists: function (sId) {
            if (!sId) { return Promise.resolve(false); }
            return this.getOwnerComponent().getModel()
                .bindList("/ValidationRules", null, [], [new Filter("validation_id", FilterOperator.EQ, sId)],
                    { $select: "validation_id" })
                .requestContexts(0, 1)
                .then(function (aCtx) { return aCtx.length > 0; });
        },

        // Live feedback when leaving the Validation Name box (new rules only).
        onIdBlur: function (oEvent) {
            if (!this._oViewModel.getProperty("/isNew")) { return; }
            var oInput = oEvent.getSource();
            var sId = oInput.getValue().trim().toUpperCase();
            if (!sId) { oInput.setValueState("None"); oInput.setValueStateText(""); return; }
            this._sIdCheckToken = sId;
            this._idExists(sId).then(function (bExists) {
                if (this._sIdCheckToken !== sId) { return; }
                oInput.setValueState(bExists ? "Error" : "None");
                oInput.setValueStateText(bExists ? "Validation Name \"" + sId + "\" already exists." : "");
            }.bind(this)).catch(function () { /* checked again on Save */ });
        },

        _doSave: function (sId, sTrigger, bIsNew) {
            this._oViewModel.setProperty("/busy", true);
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                // function_name, description, error_message, input_param_* are
                // two-way bound. Only set the key (on create) and the Select value.
                if (bIsNew) {
                    oCtx.setProperty("validation_id", sId);
                }
                // make sure the typed values are on the record being saved
                [["inFunction", "function_name"], ["inErrorMessage", "error_message"],
                 ["inDescription", "description"]].forEach(function (a) {
                    var v = this._formValue(a[0], a[1]);
                    if (v && oCtx.getProperty(a[1]) !== v) { oCtx.setProperty(a[1], v); }
                }.bind(this));
                if (oCtx.getProperty("trigger_on") !== sTrigger) {
                    oCtx.setProperty("trigger_on", sTrigger);
                }
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("validationUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    return this._saveLinks(sId).then(function () { return bWasCreated; });
                }.bind(this))
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Validation rule saved successfully.");

                    if (bWasCreated) {
                        // Delay slightly so the toast actually paints before the
                        // route change tears the page down.
                        this._oCreateListBinding = null;
                        setTimeout(this.onNavBack.bind(this), 300);
                    } else if (oCtx) {
                        this._loadUsage();
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }
                }.bind(this))
                .catch(function (oErr) {
                    this._oViewModel.setProperty("/busy", false);
                    var sMsg = oErr && oErr.message ? oErr.message : "Unknown error";
                    if (/UNIQUE|already exists|duplicate/i.test(sMsg)) {
                        sMsg = "Validation Name \"" + sId + "\" already exists. Choose a different name.";
                    }
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("validationUpdate");
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
                MessageToast.show("No validation rule selected to copy.");
                return;
            }
            this.getOwnerComponent().getModel().resetChanges("validationUpdate");
            oCtx.requestObject().then(function (oData) {
                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/ValidationRules", null, [], [], {
                    $$updateGroupId: "validationUpdate"
                });
                var oNewCtx = oListBinding.create({
                    validation_id : "",
                    description   : oData.description ? oData.description + " (Copy)" : "",
                    function_name : oData.function_name,
                    input_param_1 : oData.input_param_1,
                    input_param_2 : oData.input_param_2,
                    input_param_3 : oData.input_param_3,
                    trigger_on    : oData.trigger_on,
                    error_message : oData.error_message
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
                    validation_id: "",
                    function_name: oData.function_name,
                    trigger_on   : oData.trigger_on
                });

                this.byId("detailTabs").setSelectedKey("general");
                MessageToast.show("Rule copied — enter a new Validation Name and press Save.");
            }.bind(this));
        },

        // ── Navigation ───────────────────────────────────────────────
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("validationRules");
        }
    });
});