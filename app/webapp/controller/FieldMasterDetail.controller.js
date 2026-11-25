sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/Select",
    "sap/m/Switch",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm",
  ],
  function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    MessageToast,
    MessageBox,
    DateFormat,
    Dialog,
    Button,
    Input,
    Label,
    Select,
    Switch,
    Item,
    SimpleForm,
  ) {
    "use strict";

    var oDateFmt = DateFormat.getDateTimeInstance({ style: "medium" });

    return Controller.extend("mdm.portal.controller.FieldMasterDetail", {
      // ── Lifecycle ────────────────────────────────────────────────

      onInit: function () {
        // Role assignments added on the Usage tab, written when the field is saved
        this.getView().setModel(new JSONModel({ items: [], saved: [], rows: [] }), "pend");
        // Grid columns added to a field that is not saved yet - written with the field
        this.getView().setModel(new JSONModel({ items: [] }), "pendCols");
        this._oViewModel = new JSONModel({
          busy: false,
          isNew: false,
          isDirty: false,
          selectedTab: "general",
        });
        this.getView().setModel(this._oViewModel, "view");

        // Load all lookup dropdowns into a separate JSON model
        this._loadLookups();

        var oRouter = this.getOwnerComponent().getRouter();
        oRouter
          .getRoute("fieldMasterDetail")
          .attachPatternMatched(this._onRouteMatched, this);
        this.getView().attachModelContextChange(this._syncDecimals, this);
      },

      // ── Lookup loader ────────────────────────────────────────────

      _loadLookups: function () {
        var oModel = this.getOwnerComponent().getModel();
        var oLookupsModel = new JSONModel({
          displayTypes: [],
          valueTables: [],
          validationRules: [],
          validationRulesAll: [],
          dataTypes: [],
          mainGroups: [],
        });
        this.getView().setModel(oLookupsModel, "lookups");

        oModel
          .bindList("/MetaDisplayTypes", null, [new Sorter("sequence")])
          .requestContexts(0, 50)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/displayTypes",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("display_type_id"),
                  text: c.getProperty("display_type_name"),
                };
              }),
            );
          });

        oModel
          .bindList("/MetaDataTypes", null, [new Sorter("sequence")])
          .requestContexts(0, 50)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/dataTypes",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("code"),
                  text:
                    c.getProperty("code") +
                    " — " +
                    c.getProperty("description"),
                };
              }),
            );
          });

        oModel
          .bindList("/ValueTables", null, [new Sorter("value_table_id")])
          .requestContexts(0, 5000)
          .then(function (aCtx) {
            var aItems = [{ key: "", text: "— None —" }];
            aCtx.forEach(function (c) {
              aItems.push({
                key: c.getProperty("value_table_id"),
                text:
                  c.getProperty("value_table_id") +
                  " — " +
                  c.getProperty("description"),
              });
            });
            oLookupsModel.setProperty("/valueTables", aItems);
          });

        oModel
          .bindList("/ValidationRules", null, [new Sorter("validation_id")])
          .requestContexts(0, 200)
          .then(function (aCtx) {
            var aItems = [{ key: "", text: "— None —" }];
            aCtx.forEach(function (c) {
              aItems.push({
                key: c.getProperty("validation_id"),
                fn: c.getProperty("function_name"),
                text:
                  c.getProperty("validation_id") +
                  " — " +
                  c.getProperty("function_name"),
              });
            });
            oLookupsModel.setProperty("/validationRulesAll", aItems);
            this._syncValidationRules();
          }.bind(this));

        oModel
          .bindList(
            "/FieldGroups",
            null,
            [new Sorter("sequence")],
            [new Filter("parent_group_id_group_id", FilterOperator.EQ, null)],
          )
          .requestContexts(0, 100)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/mainGroups",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("group_id"),
                  text:
                    c.getProperty("group_id") +
                    " — " +
                    c.getProperty("description"),
                };
              }),
            );
          });
      },

      // ── Route matched ────────────────────────────────────────────

      _onRouteMatched: function (oEvent) {
        var sRaw     = decodeURIComponent(oEvent.getParameter("arguments").fieldId);
        var sFieldId = sRaw === "NEW" ? "NEW" : sRaw.toUpperCase();
        // Reset dirty flag on every navigation
        this._oViewModel.setProperty("/isDirty", false);
        this.getView().getModel("pend").setProperty("/items", []);
        this.getView().getModel("pendCols").setProperty("/items", []);
        this._oViewModel.setProperty("/gridColumnCount", "");
        this._sVtShown = undefined;   // force the Value Table Details box to refresh
        this.getView().getModel("pend").setProperty("/saved", []);
        this._refreshUsageRows();

        if (sFieldId === "NEW") {
          // A new field starts on the General tab with an empty change log -
          // never on the tab / log rows of the field that was open before.
          this._oViewModel.setProperty("/selectedTab", "general");
          var oTabs = this.byId("detailTabs");
          if (oTabs) { oTabs.setSelectedKey("general"); }
          this._oViewModel.setProperty("/clCreatedAt", "—");
          this._oViewModel.setProperty("/clCreatedBy", "—");
          this._oViewModel.setProperty("/clModifiedAt", "—");
          this._oViewModel.setProperty("/clModifiedBy", "—");
          this._createNewField();
        } else {
          this._bindField(sFieldId);
        }
        // data arrives asynchronously: re-check once it has rendered
        [150, 600, 1500].forEach(function (n) { setTimeout(this._syncDecimals.bind(this), n); }.bind(this));
        if (this._oViewModel.getProperty("/selectedTab") === "changelog") {
          setTimeout(this._loadChangeLog.bind(this), 300);
        }
      },

      // ── Binding ──────────────────────────────────────────────────

      _bindField: function (sFieldId) {
        this._oViewModel.setProperty("/isNew", false);
        this._oViewModel.setProperty("/busy", true);

        var sPath = "/FieldMasters('" + sFieldId + "')";
        this.getView().bindObject({
          path: sPath,
          parameters: {
            $select: [
              "field_id", "description", "data_type", "length", "decimals",
              "display_type", "active", "grid", "source_table", "source_field",
              "main_group_group_id", "sub_group_group_id",
              "value_table_value_table_id", "validation_validation_id"
            ].join(","),
            $expand: [
              "main_group($select=group_id,description)",
              "sub_group($select=group_id,description)",
              "value_table($select=value_table_id,source_table,output_key,output_desc,description)",
              "validation($select=validation_id,function_name,description,input_param_1,input_param_2,input_param_3,error_message)",
            ].join(","),
            $$updateGroupId: "fieldMasterUpdate", // holds changes until submitBatch
          },
          events: {
            change: function () {
              // Runs on every (re)bind - also when the data is already cached and
              // dataReceived does not fire - so the Value Table select and the
              // details box always match the field, however late the data arrives.
              var oCtx = this.getView().getBindingContext();
              if (!oCtx) { return; }
              oCtx.requestObject().then(function (oData) {
                if (oData) { this._showFieldValueTable(oData); }
              }.bind(this));
            }.bind(this),
            dataReceived: function () {
              this._oViewModel.setProperty("/busy", false);
              var oCtx = this.getView().getBindingContext();
              if (!oCtx) {
                MessageToast.show("Field not found");
                this.onNavBack();
                return;
              }
              oCtx.requestObject().then(
                function (oData) {
                  this._updateHeader(oData);
                  this._updateValueTablePreview(oData.value_table);
                  this._updateValidationPreview(oData.validation);
                  this._loadSubGroups(oData.main_group_group_id);
                }.bind(this),
              );
              // Existing field — Field ID should not be changed
              this.byId("inFieldId").setEditable(false);
            }.bind(this),
          },
        });
      },

      // ── New field ────────────────────────────────────────────────

      _createNewField: function () {
        this._oViewModel.setProperty("/isNew", true);
        this._oViewModel.setProperty("/busy", true);

        var oModel = this.getView().getModel();

        Promise.all([
          oModel
            .bindList("/MetaDataTypes", null, [new Sorter("sequence")])
            .requestContexts(0, 1),
          oModel
            .bindList("/MetaDisplayTypes", null, [new Sorter("sequence")])
            .requestContexts(0, 1),
        ])
          .then(
            function (aResults) {
              var sDefaultDataType = aResults[0].length
                ? aResults[0][0].getProperty("code")
                : "";
              var sDefaultDisplayType = aResults[1].length
                ? aResults[1][0].getProperty("display_type_id")
                : "";

              var oListBinding = oModel.bindList("/FieldMasters", null, [], [], {
                $$updateGroupId: "fieldMasterUpdate"
              });
              // Keep a reference so the transient row is not discarded by the
              // OData V4 model before submitBatch sends its POST.
              this._oCreateListBinding = oListBinding;
              var oContext = oListBinding.create({
                field_id: "",
                description: "",
                data_type: sDefaultDataType,
                length: 10,
                decimals: null,
                display_type: sDefaultDisplayType,
                active: true,
                grid: false,
                source_table: "",
                source_field: "",
              });
              // If the previous page was an existing field, the view still
              // carries the object binding _bindField set up via bindObject().
              // An object binding's context takes precedence over
              // setBindingContext, so without unbinding it first the form
              // keeps showing that old record's data instead of a blank one —
              // the same issue already fixed in onCopy below.
              this.getView().unbindObject();
              this.getView().setBindingContext(oContext);
              this._clearValueHelp();
              this._updateHeader({ field_id: "New Field", description: "" });
              this._oViewModel.setProperty("/busy", false);
            }.bind(this),
          )
          .catch(
            function () {
              var oListBinding = oModel.bindList("/FieldMasters", null, [], [], {
                $$updateGroupId: "fieldMasterUpdate"
              });
              this._oCreateListBinding = oListBinding;
              var oContext = oListBinding.create({
                field_id: "",
                description: "",
                data_type: "",
                length: 10,
                decimals: null,
                display_type: "",
                active: true,
                grid: false,
                source_table: "",
                source_field: "",
              });
              this.getView().unbindObject();
              this.getView().setBindingContext(oContext);
              this._clearValueHelp();
              this._updateHeader({ field_id: "New Field", description: "" });
              this._oViewModel.setProperty("/busy", false);
            }.bind(this),
          );
      },

      // ── Header helpers ───────────────────────────────────────────

      _updateHeader: function (oData) {
        // Guard against late-resolving promises firing after the view has
        // been destroyed or rebound to a different field (route changed,
        // user navigated away/back quickly, etc.) — mirrors the same
        // destroyed-view race-condition fix already applied on the
        // BP Roles detail screen.
        var oView = this.getView();
        if (!oView || oView.bIsDestroyed) { return; }

        var oTitle = this.byId("pageTitle");
        if (!oTitle) { return; }

        var sTitle = oData.field_id
          ? oData.field_id +
            (oData.description ? " — " + oData.description : "")
          : "New Field";
        oTitle.setText(sTitle);

        var oStatus = this.byId("attrStatus");
        if (oStatus) { oStatus.setText(oData.active ? "Active" : "Inactive"); }

        var oCreated = this.byId("attrCreated");
        if (oCreated) { oCreated.setText(oData.createdBy || "—"); }

        var oDate = this.byId("attrDate");
        if (oDate) {
          oDate.setText(
            oData.createdAt ? oDateFmt.format(new Date(oData.createdAt)) : "—",
          );
        }

        var oModified = this.byId("attrModified");
        if (oModified) {
          oModified.setText(
            oData.modifiedAt ? oDateFmt.format(new Date(oData.modifiedAt)) : "—",
          );
        }
      },

      // ── Dirty flag ───────────────────────────────────────────────

      onFieldChange: function () {
        this._oViewModel.setProperty("/isDirty", true);
      },

      // Decimals only make sense for DECIMAL: the input is enabled by an
      // expression binding in the view (enabled="{= ${data_type} === 'DECIMAL' }");
      // here we clear any leftover decimals when switching to another type so
      // a stale value is never saved.
      // Imperative enable/disable (does not depend on binding timing):
      // runs on data type change, whenever the view's binding context or
      // model data changes (load, navigation, new/copy) and after saves.
      _syncDecimals: function () {
        var oIn = this.byId("inDecimals");
        var oSel = this.byId("selDataType");
        if (!oIn || !oSel) { return; }
        var oCtx = this.getView().getBindingContext();
        var sType = oSel.getSelectedKey() || (oCtx && oCtx.getProperty("data_type")) || "";
        oIn.setEnabled(sType === "DECIMAL");
        this._syncValidationRules();
        this._syncValueHelp();
      },

      // The Value Table (and its details) only apply to Search Help.
      // For every other display type they are hidden.
      // The "Value Table Details" box (source table / output key / output
      // description) used to be filled only when the field's data was first
      // received. Opening a field whose data was already cached, or coming
      // back to one, skipped that and left the box showing dashes. Check on
      // every sync which value table the field has and refresh when it changed.
      _refreshVtPreview: function () {
        var oCtx = this.getView().getBindingContext();
        var sId = oCtx && oCtx.getProperty("value_table_value_table_id");
        if (sId === this._sVtShown) { return; }
        if (sId === undefined) { return; }            // data not there yet
        this._sVtShown = sId;
        this._updateValueTablePreview(sId ? { value_table_id: sId } : null);
      },

      // Which data types each validation function makes sense for. A rule not
      // listed here (a custom one) is offered for every data type.
      _VALIDATION_TYPES: {
        checkNumeric:     ["INTEGER", "DECIMAL"],
        checkEmailFormat: ["STRING"],
        checkDateRange:   ["DATE"],
        checkMaxLength:   ["STRING"]
      },

      _ruleFits: function (sFn, sType) {
        var a = this._VALIDATION_TYPES[sFn];
        return !a || !sType || a.indexOf(sType) >= 0;
      },

      _currentDataType: function () {
        var oSel = this.byId("selDataType");
        var oCtx = this.getView().getBindingContext();
        return (oSel && oSel.getSelectedKey()) || (oCtx && oCtx.getProperty("data_type")) || "";
      },

      // Offer only the validation rules that fit the field's data type, and
      // drop an already-chosen rule that no longer fits (for example a date
      // check on a Decimal field).
      _syncValidationRules: function (bClear) {
        var oLk = this.getView().getModel("lookups");
        if (!oLk) { return; }
        var sType = this._currentDataType();
        var aAll = oLk.getProperty("/validationRulesAll") || [];
        oLk.setProperty("/validationRules", aAll.filter(function (r) {
          return !r.key || this._ruleFits(r.fn, sType);
        }.bind(this)));
        if (!bClear) { return; }
        var oCtx = this.getView().getBindingContext();
        var sKey = oCtx && oCtx.getProperty("validation_validation_id");
        if (!sKey) { return; }
        var oRule = aAll.filter(function (r) { return r.key === sKey; })[0];
        if (oRule && !this._ruleFits(oRule.fn, sType)) {
          oCtx.setProperty("validation_validation_id", null);
          var oVal = this.byId("selValidation");
          if (oVal) { oVal.setSelectedKey(""); }
          this._clearValidationPreview();
          sap.m.MessageToast.show("Validation rule cleared \u2014 it does not apply to data type " + sType + ".");
        }
      },

      // A brand-new field must start with no value table. The Select keeps
      // showing the previous field's choice when the new record has no value
      // for it, and the details box keeps its old text, so reset both.
      _clearValueHelp: function () {
        var oSel = this.byId("selValueTable");
        if (oSel) { oSel.setSelectedKey(""); }
        ["vtSource", "vtOutputKey", "vtOutputDesc"].forEach(function (id) {
          var o = this.byId(id); if (o) { o.setText("\u2014"); }
        }.bind(this));
        this._sVtShown = null;
        this._syncValueHelp();
        // same for the Validation tab: the rule, trigger and preview of the
        // previous field must not carry over into a new one
        var oVal = this.byId("selValidation");
        if (oVal) { oVal.setSelectedKey(""); }
        var oTrg = this.byId("selTrigger");
        if (oTrg) { oTrg.setSelectedKey("CHANGE"); }
        this._clearValidationPreview();
        this._syncValidationRules();
      },

      _syncValueHelp: function () {
        this._refreshVtPreview();
        var oSel = this.byId("selDisplayType");
        var oVb = this.byId("vbValueTable");
        var oPn = this.byId("pnlValueTablePreview");
        if (!oSel || !oVb || !oPn) { return; }
        var oCtx = this.getView().getBindingContext();
        var sType = oSel.getSelectedKey() || (oCtx && oCtx.getProperty("display_type")) || "";
        var bShow = sType === "SEARCH_HELP";
        oVb.setVisible(bShow);
        oPn.setVisible(bShow);
      },

      onDisplayTypeChange: function () {
        var sType = this.byId("selDisplayType").getSelectedKey();
        if (sType !== "SEARCH_HELP") {
          // drop any previously chosen value table so a stale link is not saved
          var oCtx = this.getView().getBindingContext();
          if (oCtx && oCtx.getProperty("value_table_value_table_id")) {
            oCtx.setProperty("value_table_value_table_id", null);
          }
          this.byId("selValueTable").setSelectedKey("");
          ["vtSource", "vtOutputKey", "vtOutputDesc"].forEach(function (id) {
            var o = this.byId(id); if (o) { o.setText("\u2014"); }
          }.bind(this));
        }
        this._syncValueHelp();
        this.onFieldChange();
      },

      onDataTypeChange: function () {
        var oCtx = this.getView().getBindingContext();
        var sType = this.byId("selDataType").getSelectedKey();
        if (oCtx && sType !== "DECIMAL" && oCtx.getProperty("decimals") !== null
            && oCtx.getProperty("decimals") !== undefined) {
          oCtx.setProperty("decimals", null);
        }
        this._syncDecimals();
        this._syncValidationRules(true);
        this.onFieldChange();
      },

      // Add/Edit Grid Column dialog: data type decides length / decimals,
      // display type decides whether the value table + source fields apply.
      _onGridDataTypeChange: function (bFromUser) {
        this._syncGridDialog(bFromUser);
      },

      // bFromUser: the user just changed data type / display type, so defaults
      // may be applied. When the dialog is only being filled (false) the
      // stored values are kept and only the visibility is updated.
      _syncGridDialog: function (bFromUser) {
        var oD = this._oGridColumnDialog;
        if (!oD) { return; }
        var sType = oD._oDataType.getSelectedKey();
        var sDsp  = oD._oDisplayType.getSelectedKey();

        // --- display type defaults that follow the data type ---------------
        if (bFromUser) {
          if (sType === "DATE" && (!sDsp || sDsp === "INPUT" || sDsp === "CHECKBOX")) { sDsp = "DATEPICKER"; }
          else if (sType === "BOOLEAN") { sDsp = "CHECKBOX"; }
          else if (sType && sType !== "DATE" && (sDsp === "DATEPICKER" || (sType !== "BOOLEAN" && sDsp === "CHECKBOX"))) { sDsp = "INPUT"; }
          else if (sType && !sDsp) { sDsp = "INPUT"; }
          oD._oDisplayType.setSelectedKey(sDsp);
        }

        // --- length / decimals ------------------------------------------------
        var bLen = sType === "STRING" || sType === "INTEGER" || sType === "DECIMAL" || sType === "DATE";
        var bDec = sType === "DECIMAL";
        oD._oLengthLabel.setVisible(bLen);
        oD._oLengthInput.setVisible(bLen);
        oD._oLengthInput.setEditable(sType !== "DATE");     // a date is always 8
        oD._oDecimalsLabel.setVisible(bDec);
        oD._oDecimalsInput.setVisible(bDec);
        if (sType === "DATE") { oD._oLengthInput.setValue("8"); }
        else if (bFromUser && !bLen) { oD._oLengthInput.setValue(""); }
        else if (bFromUser && oD._sPrevGridType === "DATE") { oD._oLengthInput.setValue(""); }
        if (!bDec) { oD._oDecimalsInput.setValue(""); }
        oD._sPrevGridType = sType;

        // --- value table + source fields only for lists ------------------------
        var bList = sDsp === "SEARCH_HELP" || sDsp === "DROPDOWN";
        [oD._oValueTableLabel, oD._oValueTable, oD._oSourceTableLabel, oD._oSourceTable,
         oD._oSourceFieldLabel, oD._oSourceField].forEach(function (o) { o.setVisible(bList); });
        oD._oValueTableLabel.setRequired(bList);
        if (!bList) {
          oD._oValueTable.setSelectedKey("");
          oD._oSourceTable.setValue("");
          oD._oSourceField.setValue("");
        }

        // --- validation rules that fit the data type ---------------------------
        var oB = oD._oValidation.getBinding("items");
        if (oB) {
          oB.filter(sType ? [new Filter({
            path: "fn",
            test: function (fn) { return !fn || this._ruleFits(fn, sType); }.bind(this)
          })] : []);
        }
        var sRule = oD._oValidation.getSelectedKey();
        if (sRule) {
          var oRule = (this.getView().getModel("lookups").getProperty("/validationRulesAll") || [])
            .filter(function (r) { return r.key === sRule; })[0];
          if (oRule && !this._ruleFits(oRule.fn, sType)) { oD._oValidation.setSelectedKey(""); }
        }
      },

      onGridSwitchChange: function (oEvent) {
        this.onFieldChange();
      },

      // ── Tab 2: Grouping ──────────────────────────────────────────

      onMainGroupChange: function (oEvent) {
        var sGroupId = oEvent.getSource().getSelectedKey();
        this._loadSubGroups(sGroupId);
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
      },

      _loadSubGroups: function (sMainGroupId) {
        if (!sMainGroupId) {
          return;
        }
        var oSubSel = this.byId("selSubGroup");
        if (!oSubSel) {
          return; // Grouping tab removed — nothing to populate
        }
        var oModel = this.getView().getModel();
        oModel
          .bindList("/FieldGroups", null, null, [
            new Filter(
              "parent_group_id_group_id",
              FilterOperator.EQ,
              sMainGroupId,
            ),
          ])
          .requestContexts()
          .then(function (aContexts) {
            oSubSel.destroyItems();
            aContexts.forEach(function (oCtx) {
              oSubSel.addItem(
                new sap.ui.core.Item({
                  key: oCtx.getProperty("group_id"),
                  text:
                    oCtx.getProperty("group_id") +
                    " — " +
                    oCtx.getProperty("description"),
                }),
              );
            });
          });
      },

      // ── Tab 3: Value Help ────────────────────────────────────────

      onValueTableChange: function (oEvent) {
        var sKey = oEvent.getSource().getSelectedKey();
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
        this._sVtShown = sKey || null;
        this._updateValueTablePreview(sKey ? { value_table_id: sKey } : null);
      },

      // Make sure the Value Table select holds the field's table (adding it to
      // the list if the lookup did not contain it) and refresh the details box.
      _showFieldValueTable: function (oData) {
        var sId = oData.value_table_value_table_id ||
                  (oData.value_table && oData.value_table.value_table_id) || "";
        if (sId) {
          var oLookups = this.getView().getModel("lookups");
          var aItems = oLookups.getProperty("/valueTables") || [];
          if (!aItems.some(function (i) { return i.key === sId; })) {
            var sDesc = (oData.value_table && oData.value_table.description) || "";
            oLookups.setProperty("/valueTables", aItems.concat([{ key: sId, text: sId + (sDesc ? " \u2014 " + sDesc : "") }]));
          }
          var oSel = this.byId("selValueTable");
          if (oSel && oSel.getSelectedKey() !== sId && !this._oViewModel.getProperty("/isDirty")) {
            oSel.setSelectedKey(sId);
          }
        }
        this._sVtShown = sId || null;
        this._updateValueTablePreview(sId ? { value_table_id: sId } : null);
      },

      _updateValueTablePreview: function (oVT) {
        if (!oVT || !oVT.value_table_id) {
          this.byId("vtSource").setText("—");
          this.byId("vtOutputKey").setText("—");
          this.byId("vtOutputDesc").setText("—");
          return;
        }
        if (oVT.source_table) {
          this.byId("vtSource").setText(oVT.source_table);
          this.byId("vtOutputKey").setText(oVT.output_key || "—");
          this.byId("vtOutputDesc").setText(oVT.output_desc || "—");
        } else {
          this.getView()
            .getModel()
            .bindContext("/ValueTables('" + oVT.value_table_id + "')")
            .requestObject()
            .then(
              function (oData) {
                this.byId("vtSource").setText(oData.source_table || "—");
                this.byId("vtOutputKey").setText(oData.output_key || "—");
                this.byId("vtOutputDesc").setText(oData.output_desc || "—");
              }.bind(this),
            );
        }
      },

      // ── Tab 4: Validation ────────────────────────────────────────

      onValidationChange: function (oEvent) {
        var sKey = oEvent.getSource().getSelectedKey();
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
        if (!sKey) {
          this._clearValidationPreview();
          return;
        }
        this.getView()
          .getModel()
          .bindContext("/ValidationRules('" + sKey + "')")
          .requestObject()
          .then(
            function (oData) {
              this._updateValidationPreview(oData);
            }.bind(this),
          );
      },

      _updateValidationPreview: function (oRule) {
        if (!oRule) {
          this._clearValidationPreview();
          return;
        }
        this.byId("valFnName").setText(oRule.function_name || "—");
        this.byId("valDesc").setText(oRule.description || "—");
        this.byId("valParam1").setText(oRule.input_param_1 || "—");
        this.byId("valParam2").setText(oRule.input_param_2 || "—");
        this.byId("valParam3").setText(oRule.input_param_3 || "—");
        this.byId("valErrMsg").setText(oRule.error_message || "—");
      },

      _clearValidationPreview: function () {
        [
          "valFnName",
          "valDesc",
          "valParam1",
          "valParam2",
          "valParam3",
          "valErrMsg",
        ].forEach(
          function (sId) {
            this.byId(sId).setText("—");
          }.bind(this),
        );
      },

      // ── Tab 5: Usage ─────────────────────────────────────────────

      onUsageRowPress: function (oEvent) {
        var o = oEvent.getSource().getBindingContext("pend").getObject();
        if (o && !o.pending && o.role_id) {
          this.getOwnerComponent()
            .getRouter()
            .navTo("bpRoleDetail", { roleId: encodeURIComponent(o.role_id.toLowerCase()) });
        }
      },

      // Rebuilds the single usage list: saved assignments + pending ones.
      _refreshUsageRows: function () {
        var oPend = this.getView().getModel("pend");
        var aSaved = oPend.getProperty("/saved") || [];
        var aPending = (oPend.getProperty("/items") || []).map(function (o) {
          return Object.assign({}, o, { pending: true });
        });
        var aRows = aSaved.concat(aPending);
        oPend.setProperty("/rows", aRows);
        var oTxt = this.byId("usageCount");
        if (oTxt) {
          oTxt.setText(aRows.length + " role assignment" + (aRows.length !== 1 ? "s" : ""));
        }
      },

      // Opens the "Assign to BP Role" dialog. Works for new and existing fields:
      // the choice is staged in the "pend" model and written on Save.
      onUsageAssign: function () {
        if (!this._oUsageDlg) {
          var oRole = new Select({ width: "100%", forceSelection: false });
          var oStatus = new Select({ width: "100%", selectedKey: "OPTIONAL", items: [
            new Item({ key: "REQUIRED", text: "Required" }),
            new Item({ key: "OPTIONAL", text: "Optional" }),
            new Item({ key: "SUPPRESS", text: "Suppress" })
          ] });
          var oSeq = new Input({ type: "Number", value: "10", width: "100%" });
          var oRo = new Switch({ state: false, customTextOn: "Yes", customTextOff: "No" });
          this._oUsageDlg = new Dialog({
            title: "Assign Field to BP Role",
            contentWidth: "28rem",
            content: new SimpleForm({
              editable: true, layout: "ResponsiveGridLayout",
              content: [
                new Label({ text: "BP Role", required: true }), oRole,
                new Label({ text: "Field Status" }), oStatus,
                new Label({ text: "Sequence" }), oSeq,
                new Label({ text: "Read Only" }), oRo
              ]
            }),
            beginButton: new Button({ text: "Add", type: "Emphasized",
              press: this._onUsageAssignConfirm.bind(this) }),
            endButton: new Button({ text: "Cancel",
              press: function () { this._oUsageDlg.close(); }.bind(this) })
          });
          this._oUsageDlg._c = { role: oRole, status: oStatus, seq: oSeq, ro: oRo };
          this.getView().addDependent(this._oUsageDlg);
        }
        var c = this._oUsageDlg._c;
        // Next free sequence = highest pending sequence + 10
        var aPend = this.getView().getModel("pend").getProperty("/items");
        var iMax = aPend.reduce(function (m, o) { return Math.max(m, o.sequence || 0); }, 0);
        c.seq.setValue(String(iMax + 10));
        c.status.setSelectedKey("OPTIONAL");
        c.ro.setState(false);
        c.role.setSelectedKey("");
        c.role.removeAllItems();
        this.getView().getModel().bindList("/BPRoles", null, [new Sorter("role_id")], [
          new Filter("active", FilterOperator.EQ, true)
        ]).requestContexts(0, 500).then(function (aCtx) {
          aCtx.forEach(function (x) {
            c.role.addItem(new Item({
              key: x.getProperty("role_id"),
              text: x.getProperty("role_id") + " \u2014 " + (x.getProperty("description") || "")
            }));
          });
        });
        this._oUsageDlg.open();
      },

      _onUsageAssignConfirm: function () {
        var c = this._oUsageDlg._c;
        var sRole = c.role.getSelectedKey();
        if (!sRole) { MessageBox.error("Please select a BP Role."); return; }
        var oPend = this.getView().getModel("pend");
        var aItems = oPend.getProperty("/items").slice();
        var bAssigned = (oPend.getProperty("/saved") || []).some(function (x) {
          return x.role_id === sRole;
        });
        if (bAssigned || aItems.some(function (o) { return o.role_id === sRole; })) {
          MessageBox.error("This field is already assigned to role " + sRole + ".");
          return;
        }
        var sText = c.role.getSelectedItem() ? c.role.getSelectedItem().getText() : sRole;
        aItems.push({
          role_id: sRole,
          description: sText.indexOf(" \u2014 ") >= 0 ? sText.split(" \u2014 ").slice(1).join(" \u2014 ") : "",
          field_status: c.status.getSelectedKey() || "OPTIONAL",
          sequence: parseInt(c.seq.getValue(), 10) || 10,
          read_only: c.ro.getState()
        });
        oPend.setProperty("/items", aItems);
        this._refreshUsageRows();
        this._oViewModel.setProperty("/isDirty", true);
        this._oUsageDlg.close();
      },

      onUsagePendingRemove: function (oEvent) {
        var oPend = this.getView().getModel("pend");
        var o = oEvent.getSource().getBindingContext("pend").getObject();
        oPend.setProperty("/items", oPend.getProperty("/items").filter(function (x) {
          return x.role_id !== o.role_id;
        }));
        this._refreshUsageRows();
      },

      // Writes the staged role assignments. Called after the field itself has
      // been saved, so for a new field the FieldMaster row already exists.
      _savePendingAssignments: function (sFieldId) {
        var oPend = this.getView().getModel("pend");
        var aItems = oPend.getProperty("/items") || [];
        if (!aItems.length) { return Promise.resolve(); }
        var oModel = this.getView().getModel();
        var oLB = oModel.bindList("/BPRoleFields", null, [], [], { $$updateGroupId: "fieldUsageAssign" });
        aItems.forEach(function (o) {
          oLB.create({
            role_role_id: o.role_id,
            field_field_id: sFieldId,
            field_status: o.field_status,
            sequence: o.sequence,
            read_only: !!o.read_only
          });
        });
        return oModel.submitBatch("fieldUsageAssign").then(function () {
          oPend.setProperty("/items", []);
          this._loadUsage();
          MessageToast.show(aItems.length + " role assignment(s) saved.");
        }.bind(this)).catch(function (e) {
          try { oModel.resetChanges("fieldUsageAssign"); } catch (x) { /* nothing pending */ }
          MessageBox.error("The field was saved, but the role assignment failed: " +
            ((e && e.message) || "Unknown error") + "\nAdd it again from the Usage tab.");
        });
      },

      // ── Save ─────────────────────────────────────────────────────

      // Reusable existence check — used both for live inline feedback
      // (onFieldIdBlur) and as the authoritative gate in onSave right
      // before submitting, so a duplicate is caught even if the user
      // never actually left the Field Name input (typed and hit Save
      // directly). $select is minimal since only existence is needed.
      _fieldIdExists: function (sId) {
        if (!sId) { return Promise.resolve(false); }
        var oModel = this.getOwnerComponent().getModel();
        return oModel
          .bindList("/FieldMasters", null, [], [
            new Filter("field_id", FilterOperator.EQ, sId)
          ], { $select: "field_id" })
          .requestContexts(0, 1)
          .then(function (aCtx) { return aCtx.length > 0; });
      },

      // Live feedback while filling in the form — fires on blur (not on
      // every keystroke, to avoid a server round trip per character).
      // Only relevant for a new record; field_id is read-only once saved.
      onFieldIdBlur: function (oEvent) {
        if (!this._oViewModel.getProperty("/isNew")) { return; }

        var oInput = oEvent.getSource();
        var sId = oInput.getValue().trim().toUpperCase();
        if (!sId) { oInput.setValueState("None"); oInput.setValueStateText(""); return; }

        // Tags this specific check with the value it's for, so a slow
        // response for an already-changed value can't overwrite a newer,
        // more current result once it comes back.
        this._sFieldIdCheckToken = sId;
        this._fieldIdExists(sId)
          .then(function (bExists) {
            if (this._sFieldIdCheckToken !== sId) { return; } // superseded by a later check
            oInput.setValueState(bExists ? "Error" : "None");
            oInput.setValueStateText(bExists ? "Field ID \"" + sId + "\" already exists." : "");
          }.bind(this))
          .catch(function () {
            // A failed check shouldn't block typing — the authoritative
            // check in onSave (and the server's own constraint) still
            // catch a duplicate before anything is actually saved.
          });
      },

      onSave: function () {
        var sFieldId = this.byId("inFieldId").getValue().trim().toUpperCase();
        var sDesc = this.byId("inDescription").getValue().trim();

        if (!sFieldId) {
          MessageBox.error("Field Name is required.");
          return;
        }
        if (!sDesc) {
          MessageBox.error("Description is required.");
          return;
        }

        // The validation rule must fit the data type (no date check on a decimal).
        var oCtxV = this.getView().getBindingContext();
        var sValId = oCtxV && oCtxV.getProperty("validation_validation_id");
        if (sValId) {
          var oRuleV = (this.getView().getModel("lookups").getProperty("/validationRulesAll") || [])
            .filter(function (r) { return r.key === sValId; })[0];
          var sTypeV = this._currentDataType();
          if (oRuleV && !this._ruleFits(oRuleV.fn, sTypeV)) {
            MessageBox.error("Validation rule " + sValId + " (" + oRuleV.fn + ") cannot be used with data type " +
              sTypeV + ". Choose a matching rule or remove it on the Validation tab.");
            return;
          }
        }

        // A Search Help display type renders a value list — without a
        // Value Table mapped, it would show with nothing to select. Require one
        // before saving so the field is actually usable once created.
        // Skipped for grid fields: display_type/value_table on this tab describe
        // how the field itself renders as a single value, which no longer applies
        // once the field is maintained as a grid — the Value Help tab is hidden
        // in that case (see visible="{= !${grid} }" in the view) and each grid
        // column carries its own display_type/value_table instead.
        var bGrid = this.byId("swGrid").getState();
        var sDisplayType = this.byId("selDisplayType").getSelectedKey();
        var sValueTable  = this.byId("selValueTable").getSelectedKey();
        if (!bGrid && sDisplayType === "SEARCH_HELP" && !sValueTable) {
          MessageBox.error("A Value Table is required when Display Type is Search Help. Select one on the Value Help tab before saving.");
          this.byId("detailTabs").setSelectedKey("valuehelp");
          return;
        }

        var bIsNew = this._oViewModel.getProperty("/isNew");
        var oInput = this.byId("inFieldId");

        // Authoritative duplicate check — re-run here (not just trusted from
        // onFieldIdBlur) so a duplicate is still caught if the user never
        // left the Field Name input before clicking Save.
        (bIsNew ? this._fieldIdExists(sFieldId) : Promise.resolve(false))
          .then(function (bExists) {
            if (bExists) {
              oInput.setValueState("Error");
              oInput.setValueStateText("Field ID \"" + sFieldId + "\" already exists.");
              MessageBox.error("Field ID \"" + sFieldId + "\" already exists. Choose a different Field ID.");
              return;
            }

            this._oViewModel.setProperty("/busy", true);

            var oCtx = this.getView().getBindingContext();

            // field_id is the key and is two-way bound; ensure it is set for new records
            if (oCtx && bIsNew) {
              oCtx.setProperty("field_id", sFieldId);
            }

            this.getView()
              .getModel()
              .submitBatch("fieldMasterUpdate")
              .then(
                function () {
                  if (bIsNew && oCtx && typeof oCtx.created === "function") {
                    var pCreated = oCtx.created();
                    if (pCreated && typeof pCreated.then === "function") {
                      return pCreated.then(function () { return true; });
                    }
                    return true;
                  }
                  return false;
                }
              )
              .then(
                function (bWasCreated) {
                  // field row exists now -> write staged role assignments
                  return this._savePendingAssignments(sFieldId)
                    .then(function () { return this._savePendingGridColumns(sFieldId); }.bind(this))
                    .then(function () { return bWasCreated; });
                }.bind(this)
              )
              .then(
                function (bWasCreated) {
                  this._oViewModel.setProperty("/busy", false);
                  this._oViewModel.setProperty("/isDirty", false);
                  MessageToast.show("Field saved successfully.");
                  // the audit row is written by the server during this save —
                  // re-read the log so the second, third… change shows up
                  this._loadChangeLog();

                  if (bWasCreated) {
                    // Showing the toast and navigating away in the same tick lets the
                    // route change tear the page down before the toast has actually
                    // painted, so it never becomes visible. A short delay lets it
                    // render first; the toast itself still floats above the list
                    // once we're there.
                    setTimeout(this.onNavBack.bind(this), 300);
                  } else {
                    var oCtx2 = this.getView().getBindingContext();
                    if (oCtx2) {
                      oCtx2.requestObject().then(
                        function (oData) {
                          if (oData) { this._updateHeader(oData); }
                        }.bind(this),
                      );
                    }
                  }
                }.bind(this),
              )
              .catch(
                function (oErr) {
                  this._oViewModel.setProperty("/busy", false);
                  // A failed create is kept by OData V4 and retried on every later
                  // submitBatch, which jams the group. Roll back the pending change
                  // so the app stays usable; the user can correct and save again.
                  try { this.getView().getModel().resetChanges("fieldMasterUpdate"); } catch (e) { /* nothing pending */ }
                  if (bIsNew) { this._oCreateListBinding = null; }

                  // Surface a duplicate Field ID (the field_id UNIQUE/PK constraint)
                  // as a specific, actionable message rather than the raw SQL text
                  // ("UNIQUE constraint failed: mdm_portal_FieldMaster.field_id").
                  // Kept as a backstop even with the up-front check above, in case
                  // of a race (two people creating the same Field ID at once).
                  var sRaw = (oErr && (oErr.message || (oErr.cause && oErr.cause.message))) || "";
                  if (bIsNew && /field_id/i.test(sRaw) && /unique|constraint|primary/i.test(sRaw)) {
                    oInput.setValueState("Error");
                    oInput.setValueStateText("Field ID \"" + sFieldId + "\" already exists.");
                    MessageBox.error(
                      "Field ID \"" + sFieldId + "\" already exists. Choose a different Field ID."
                    );
                    return;
                  }

                  MessageBox.error(
                    "Save failed: " + (sRaw || "Unknown error"),
                  );
                }.bind(this),
              );
          }.bind(this))
          .catch(function () {
            // The existence check itself failed (e.g. offline) — fall back to
            // just attempting the save; the server's own constraint and the
            // .catch() above still protect against an actual duplicate.
            MessageToast.show("Could not verify Field ID availability — attempting to save anyway.");
          }.bind(this));
      },

      // ── Cancel ───────────────────────────────────────────────────

      onCancel: function () {
        var fnGoBack = function () {
          this.getView().getModel().resetChanges("fieldMasterUpdate");
          this._oViewModel.setProperty("/isDirty", false);
          this.onNavBack();
        }.bind(this);

        if (this._oViewModel.getProperty("/isDirty")) {
          MessageBox.confirm("Discard unsaved changes?", {
            onClose: function (sAction) {
              if (sAction === MessageBox.Action.OK) {
                fnGoBack();
              }
            },
          });
        } else {
          fnGoBack();
        }
      },

      onCopy: function () {
        var oCtx = this.getView().getBindingContext();
        if (!oCtx) {
          MessageToast.show("No field selected to copy.");
          return;
        }
        // Clear any stale pending create/patch from a previous copy attempt so
        // it cannot keep retrying and colliding on the key.
        this.getView().getModel().resetChanges("fieldMasterUpdate");

        // Read current field data
        oCtx.requestObject().then(
          function (oData) {
            var oModel = this.getView().getModel();

            // Create a new record pre-populated with copied values
            // Field ID is cleared — user must enter a unique one.
            // Bound to the deferred update group so it is NOT auto-posted
            // (with $auto, a groupless create posts immediately with empty id).
            var oListBinding = oModel.bindList("/FieldMasters", null, [], [], {
              $$updateGroupId: "fieldMasterUpdate"
            });
            var oNewContext = oListBinding.create({
              field_id: "",
              description: oData.description + " (Copy)",
              data_type: oData.data_type,
              length: oData.length,
              decimals: oData.decimals,
              display_type: oData.display_type,
              active: false, // new copy starts inactive
              grid: oData.grid,
              source_table: oData.source_table,
              source_field: oData.source_field,
              main_group_group_id: oData.main_group_group_id,
              sub_group_group_id: oData.sub_group_group_id,
              value_table_value_table_id: oData.value_table_value_table_id,
              validation_validation_id: oData.validation_validation_id,
            });
            // Keep a reference so the transient list binding is not garbage-collected.
            this._oCreateListBinding = oListBinding;

            // The view still carries the object binding from the record we copied
            // FROM (set by _bindField via bindObject). An object binding's context
            // takes precedence over setBindingContext, so without unbinding it the
            // form keeps showing the original record and the copy appears to do
            // nothing. Unbind first, THEN point the view at the new transient row.
            this.getView().unbindObject();

            // Switch view to the new context
            this.getView().setBindingContext(oNewContext);

            // Field ID was made read-only while viewing the source record; the
            // copy needs a brand-new key, so re-enable the input.
            this.byId("inFieldId").setEditable(true);

            // Reset state flags
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/isDirty", true);

            // Update header to show copy mode
            this._updateHeader({
              field_id: "",
              description: oData.description + " (Copy)",
              active: false,
              createdBy: null,
              createdAt: null,
              modifiedAt: null,
            });

            // Reload sub groups for the copied main group
            this._loadSubGroups(oData.main_group_group_id);

            // Update previews
            this._updateValueTablePreview(oData.value_table);
            this._updateValidationPreview(oData.validation);

            // Switch to General tab so user sees Field ID input first
            this.byId("detailTabs").setSelectedKey("general");

            MessageToast.show(
              "Field copied — enter a new Field Name and press Save.",
            );
          }.bind(this),
        );
      },

      // ── Tab bar ──────────────────────────────────────────────────

      onTabSelect: function (oEvent) {
        var sKey = oEvent.getParameter("key");
        this._oViewModel.setProperty("/selectedTab", sKey);
        if (sKey === "usage") {
          this._loadUsage();
        }
        if (sKey === "changelog") {
          this._loadChangeLog();
        }
        if (sKey === "gridcolumns") {
          this._loadGridColumnCount();
        }
      },

      _loadUsage: function () {
        var oPend = this.getView().getModel("pend");
        // A new (unsaved) field has no saved assignments yet; also avoids
        // showing the previous field's data while the new context settles.
        if (this._oViewModel.getProperty("/isNew")) {
          oPend.setProperty("/saved", []);
          this._refreshUsageRows();
          return;
        }
        var oCtx = this.getView().getBindingContext();
        var sFieldId = oCtx && oCtx.getProperty("field_id");
        if (!sFieldId) { return; }

        this.getView().getModel().bindList("/BPRoleFields", null, [new Sorter("sequence")], [
          new Filter("field_field_id", FilterOperator.EQ, sFieldId)
        ], { $expand: "role($select=role_id,description)" }).requestContexts(0, 500).then(function (aCtx) {
          oPend.setProperty("/saved", aCtx.map(function (c) {
            return {
              role_id: c.getProperty("role_role_id"),
              description: c.getProperty("role/description") || "",
              field_status: c.getProperty("field_status"),
              sequence: c.getProperty("sequence"),
              read_only: !!c.getProperty("read_only")
            };
          }));
          this._refreshUsageRows();
        }.bind(this)).catch(function () {});
      },

      _loadChangeLog: function () {
        var oCtx = this.getView().getBindingContext();
        if (!oCtx) { return; }
        // A new, unsaved field has no id yet: filter on a key nothing matches, so
        // the log is empty instead of still showing the previous field's rows.
        var sFieldId = oCtx.getProperty("field_id") || "__NEW__";

        // Populate managed-field strip
        var oVm = this._oViewModel;
        oVm.setProperty("/clCreatedAt",  this._fmtDate(oCtx.getProperty("createdAt")));
        oVm.setProperty("/clCreatedBy",  oCtx.getProperty("createdBy")  || "—");
        oVm.setProperty("/clModifiedAt", this._fmtDate(oCtx.getProperty("modifiedAt")));
        oVm.setProperty("/clModifiedBy", oCtx.getProperty("modifiedBy") || "—");

        var oTable = this.byId("logTable");
        var oBinding = oTable && oTable.getBinding("items");
        if (!oBinding) { return; }
        // Newest change first, and always re-read from the server: with an
        // unchanged filter the list binding would otherwise keep serving the
        // rows it loaded the first time, so later changes never appeared.
        oBinding.sort(new Sorter("acted_at", true));
        oBinding.filter([
          new Filter("entity_name", FilterOperator.EQ, "FieldMaster"),
          new Filter("entity_key",  FilterOperator.EQ, sFieldId),
        ]);
        if (oBinding.isSuspended && oBinding.isSuspended()) { oBinding.resume(); }
        else { oBinding.refresh(); }
      },

      // ── Change Log cell text: show only what actually changed ──────
      _LOG_SKIP: ["createdAt", "createdBy", "modifiedAt", "modifiedBy"],

      _logParse: function (s) {
        if (!s) { return null; }
        try { return JSON.parse(s); } catch (e) { return null; }
      },

      _logSame: function (a, b) {
        return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
      },

      _logText: function (oVal, oOther, sAction) {
        if (!oVal) { return ""; }
        var aKeys = Object.keys(oVal).filter(function (k) {
          return this._LOG_SKIP.indexOf(k) < 0;
        }.bind(this));
        if (sAction === "UPDATE" && oOther) {
          aKeys = aKeys.filter(function (k) { return !this._logSame(oVal[k], oOther[k]); }.bind(this));
        }
        return aKeys.map(function (k) {
          var v = oVal[k];
          return k + ": " + (v === null || v === undefined || v === "" ? "\u2014" : v);
        }).join("\n");
      },

      fmtLogBefore: function (sBefore, sAfter, sAction) {
        return this._logText(this._logParse(sBefore), this._logParse(sAfter), sAction);
      },

      fmtLogAfter: function (sBefore, sAfter, sAction) {
        return this._logText(this._logParse(sAfter), this._logParse(sBefore), sAction);
      },

      _fmtDate: function (sVal) {
        if (!sVal) { return "—"; }
        try { return new Date(sVal).toLocaleString(); } catch (e) { return sVal; }
      },

      // ── Grid Columns tab ────────────────────────────────────────────
      // Only relevant when this field's `grid` switch is on (the tab
      // itself is hidden via visible="{grid}" in the view). The table is
      // bound to the live `grid_columns` composition (not suspended, like
      // Change Log/Usage are) — it's always scoped to just this one
      // field's rows via the parent context, so it's cheap to load
      // up front the same way Users/Scope are on Release Code.

      _loadGridColumnCount: function () {
        if (this._oViewModel.getProperty("/isNew")) {
          this._oViewModel.setProperty("/gridColumnCount",
            String(this.getView().getModel("pendCols").getProperty("/items").length));
          return;
        }
        var oTable = this.byId("gridColumnsTable");
        if (!oTable) { return; }
        var oBinding = oTable.getBinding("items");
        if (!oBinding) { return; }

        var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
        if (!oHeaderCtx) { return; }
        oHeaderCtx.requestProperty("$count").then(function (iCount) {
          var oView = this.getView();
          if (!oView || oView.bIsDestroyed) { return; }
          this._oViewModel.setProperty("/gridColumnCount", String(iCount || 0));
        }.bind(this)).catch(function () {
          // New/unsaved record has no nav path yet — leave empty, no error.
        });
      },

      _getLoadedGridColumnRows: function () {
        if (this._oViewModel.getProperty("/isNew")) {
          return this.getView().getModel("pendCols").getProperty("/items").slice();
        }
        var oTable = this.byId("gridColumnsTable");
        if (!oTable) { return []; }
        var oBinding = oTable.getBinding("items");
        if (!oBinding) { return []; }
        return oBinding.getAllCurrentContexts().map(function (c) { return c.getObject(); });
      },

      // Boolean 'active' can arrive as true/false, 1/0, or "true"/"false" —
      // same normalisation reasoning as FieldMaster.controller.js's
      // _isActive (a raw `${active} ? … : …}` expression binding is unsafe
      // because the non-empty string "false" is truthy in JS).
      _isGridColActive: function (vActive) {
        if (typeof vActive === "string") {
          var s = vActive.trim().toLowerCase();
          return (s === "yes" || s === "true" || s === "1" || s === "x");
        }
        return vActive === true || vActive === 1;
      },
      formatGridColActiveIcon: function (vActive) {
        return this._isGridColActive(vActive) ? "sap-icon://accept" : "sap-icon://decline";
      },
      formatGridColActiveColor: function (vActive) {
        return this._isGridColActive(vActive) ? "Positive" : "Negative";
      },

      onAddGridColumn: function () {
        this._openGridColumnDialog(null);
      },

      // ── Grid columns of a field that is not saved yet ──────────────
      // Kept in the "pendCols" model and written together with the field.
      onPendingColumnRowPress: function (oEvent) {
        this._openGridColumnDialog(oEvent.getSource().getBindingContext("pendCols"));
      },

      _stagePendingColumn: function (oPayload, sEditingName) {
        var oM = this.getView().getModel("pendCols");
        var aItems = oM.getProperty("/items").slice();
        var oRow = Object.assign({}, oPayload, {
          value_table_code: oPayload.value_table_value_table_id || "",
          validation_code: oPayload.validation_validation_id || ""
        });
        if (sEditingName) {
          aItems = aItems.map(function (o) { return o.column_name === sEditingName ? oRow : o; });
        } else {
          aItems.push(oRow);
        }
        oM.setProperty("/items", aItems);
        this._oViewModel.setProperty("/isDirty", true);
        this._loadGridColumnCount();
      },

      onDeletePendingColumn: function (oEvent) {
        var sName = oEvent.getSource().getBindingContext("pendCols").getProperty("column_name");
        var oM = this.getView().getModel("pendCols");
        oM.setProperty("/items", oM.getProperty("/items").filter(function (o) {
          return o.column_name !== sName;
        }));
        this._loadGridColumnCount();
      },

      // Writes the staged grid columns once the field row exists.
      _savePendingGridColumns: function (sFieldId) {
        var oM = this.getView().getModel("pendCols");
        var aItems = oM.getProperty("/items") || [];
        var oSw = this.byId("swGrid");
        if (!aItems.length || (oSw && !oSw.getState())) { return Promise.resolve(); }
        var oModel = this.getView().getModel();
        var oLB = oModel.bindList("/GridColumns", null, [], [], { $$updateGroupId: "gridColsCreate" });
        aItems.forEach(function (o) {
          oLB.create({
            field_field_id: sFieldId,
            column_name: o.column_name,
            description: o.description,
            data_type: o.data_type,
            length: o.length,
            decimals: o.decimals,
            display_type: o.display_type,
            value_table_value_table_id: o.value_table_value_table_id,
            validation_validation_id: o.validation_validation_id,
            source_table: o.source_table,
            source_field: o.source_field,
            active: o.active
          });
        });
        return oModel.submitBatch("gridColsCreate").then(function () {
          oM.setProperty("/items", []);
          MessageToast.show(aItems.length + " grid column(s) saved.");
        }).catch(function (e) {
          try { oModel.resetChanges("gridColsCreate"); } catch (x) { /* nothing pending */ }
          MessageBox.error("The field was saved, but the grid columns could not be saved: " +
            ((e && e.message) || "Unknown error") + "\nAdd them again on the Grid Columns tab.");
        });
      },

      onGridColumnRowPress: function (oEvent) {
        this._openGridColumnDialog(oEvent.getSource().getBindingContext());
      },

      // oExistingCtx: null → "Add" mode. A row's live context → "Edit"
      // mode — column_name is locked in edit mode, same reasoning as
      // User ID on ReleaseCodeDetail's user dialog: it's part of the
      // row's composite key (field_id + column_name) and OData V4 key
      // properties can't be PATCHed after creation.
      //
      // Data Type / Display Type / Value Table / Validation Rule reuse
      // the exact same "lookups" model this view already loads once in
      // _loadLookups() for the General/Value Help/Validation tabs — no
      // separate fetch for this dialog.
      _openGridColumnDialog: function (oExistingCtx) {
        var bEdit = !!oExistingCtx;

        if (!this._oGridColumnDialog) {
          var oNameInput   = new Input({ placeholder: "e.g. AMOUNT, CURRENCY", maxLength: 40 });
          var oDescInput   = new Input({ placeholder: "Display label" });
          var oDataType    = new Select({
            width: "100%", forceSelection: false,
            items: { path: "lookups>/dataTypes", template: new Item({ key: "{lookups>key}", text: "{lookups>text}" }) },
            change: function () { this._onGridDataTypeChange(true); }.bind(this)
          });
          var oLengthLabel   = new Label({ text: "Length" });
          var oLengthInput   = new Input({ type: "Number", placeholder: "Max length" });
          var oDecimalsLabel = new Label({ text: "Decimals" });
          var oDecimalsInput = new Input({ type: "Number", placeholder: "Decimal places" });
          var oValueTableLabel = new Label({ text: "Value Table" });
          var oValueTable    = new Select({
            width: "100%", forceSelection: false,
            items: { path: "lookups>/valueTables", template: new Item({ key: "{lookups>key}", text: "{lookups>text}" }) }
          });
          var oDisplayType  = new Select({
            width: "100%", forceSelection: false,
            items: { path: "lookups>/displayTypes", template: new Item({ key: "{lookups>key}", text: "{lookups>text}" }) },
            change: function () { this._syncGridDialog(true); }.bind(this)
          });
          var oValidation   = new Select({
            width: "100%", forceSelection: false,
            items: { path: "lookups>/validationRulesAll", template: new Item({ key: "{lookups>key}", text: "{lookups>text}" }) }
          });
          var oSourceTableLabel = new Label({ text: "Source Table" });
          var oSourceTable = new Input({ placeholder: "Source SAP table (optional)" });
          var oSourceFieldLabel = new Label({ text: "Source Field" });
          var oSourceField = new Input({ placeholder: "Source SAP field (optional)" });
          var oActiveSwitch = new Switch({ state: true });

          this._oGridColumnDialog = new Dialog({
            title: "Add Grid Column",
            contentWidth: "32rem",
            content: new SimpleForm({
              editable: true,
              layout: "ResponsiveGridLayout",
              content: [
                new Label({ text: "Column Name", required: true }), oNameInput,
                new Label({ text: "Description", required: true }), oDescInput,
                new Label({ text: "Data Type", required: true }), oDataType,
                oLengthLabel, oLengthInput,
                oDecimalsLabel, oDecimalsInput,
                new Label({ text: "Display Type", required: true }), oDisplayType,
                oValueTableLabel, oValueTable,
                new Label({ text: "Validation Rule" }), oValidation,
                oSourceTableLabel, oSourceTable,
                oSourceFieldLabel, oSourceField,
                new Label({ text: "Active" }), oActiveSwitch
              ]
            }),
            beginButton: new Button({
              text: "Add",
              type: "Emphasized",
              press: function () {
                var sName    = oNameInput.getValue().trim();
                var sDesc    = oDescInput.getValue().trim();
                var sType    = oDataType.getSelectedKey();
                var sDisplay = oDisplayType.getSelectedKey();
                var oCtxBeingEdited = this._oGridColumnDialog._oEditingCtx;

                if (!sName || !sDesc || !sType || !sDisplay) {
                  MessageBox.error("Column Name, Description, Data Type, and Display Type are required.");
                  return;
                }
                // Column Name is used directly inside a UI5 binding path in
                // Create BP (e.g. "{form>" + column_name + "}") to read/write
                // each grid cell. "/" is a path SEPARATOR in that syntax, not
                // a literal character — a name like "Postal Code /City" gets
                // parsed as navigating into a nested "City" property inside
                // "Postal Code ", which doesn't exist, so the value silently
                // never displays even though it saves fine underneath. ">"
                // and curly braces are similarly reserved (model-prefix and
                // binding-expression delimiters). None of these are needed
                // in a real column name, so they're blocked here rather than
                // producing a field that looks broken later, in a different
                // screen, for a reason that isn't obvious there.
                if (/[/>{}]/.test(sName)) {
                  MessageBox.error("Column Name can't contain /, >, {, or } \u2014 these have special meaning in how the value is displayed and would prevent it from showing correctly. Try something like \"" + sName.replace(/[/>{}]/g, "") + "\" instead.");
                  return;
                }
                var sGridVal = oValidation.getSelectedKey();
                if (sGridVal) {
                  var oGridRule = (this.getView().getModel("lookups").getProperty("/validationRulesAll") || [])
                    .filter(function (r) { return r.key === sGridVal; })[0];
                  if (oGridRule && !this._ruleFits(oGridRule.fn, oDataType.getSelectedKey())) {
                    MessageBox.error("Validation rule " + sGridVal + " cannot be used with data type " + oDataType.getSelectedKey() + ".");
                    return;
                  }
                }
                if ((sDisplay === "SEARCH_HELP" || sDisplay === "DROPDOWN") && !oValueTable.getSelectedKey()) {
                  MessageBox.error("Display Type \"" + sDisplay + "\" requires a Value Table.");
                  return;
                }
                // Length / decimals must make sense for the data type
                var sLenTxt = oLengthInput.getValue().trim();
                var sDecTxt = oDecimalsInput.getValue().trim();
                var iLen = sLenTxt === "" ? null : Number(sLenTxt);
                var iDec = sDecTxt === "" ? null : Number(sDecTxt);
                if (iLen !== null && (!Number.isInteger(iLen) || iLen < 1)) {
                  MessageBox.error("Length must be a whole number greater than 0.");
                  return;
                }
                if (sType === "DATE" && iLen !== 8) {
                  MessageBox.error("A Date column has a fixed length of 8.");
                  return;
                }
                if (sType === "DECIMAL") {
                  if (iDec !== null && (!Number.isInteger(iDec) || iDec < 0)) {
                    MessageBox.error("Decimals must be a whole number of 0 or more.");
                    return;
                  }
                  if (iDec !== null && iLen === null) {
                    MessageBox.error("Enter a Length when Decimals are set.");
                    return;
                  }
                  if (iDec !== null && iLen !== null && iDec >= iLen) {
                    MessageBox.error("Decimals must be smaller than the Length.");
                    return;
                  }
                }
                if (sType === "BOOLEAN" && sDisplay !== "CHECKBOX") {
                  MessageBox.error("A Boolean column must use the Checkbox display type.");
                  return;
                }
                if (sDisplay === "CHECKBOX" && sType !== "BOOLEAN") {
                  MessageBox.error("The Checkbox display type can only be used with the Boolean data type.");
                  return;
                }
                if (sDisplay === "DATEPICKER" && sType !== "DATE") {
                  MessageBox.error("The Date Picker display type can only be used with the Date data type.");
                  return;
                }

                if (!oCtxBeingEdited) {
                  var bDuplicate = this._getLoadedGridColumnRows().some(function (o) {
                    return (o.column_name || "").toUpperCase() === sName.toUpperCase();
                  });
                  if (bDuplicate) {
                    MessageBox.error("Column \"" + sName + "\" already exists on this field.");
                    return;
                  }
                }

                var oPayload = {
                  column_name: sName,
                  description: sDesc,
                  data_type: sType,
                  length: iLen,
                  decimals: sType === "DECIMAL" ? iDec : null,
                  display_type: sDisplay,
                  value_table_value_table_id: oValueTable.getSelectedKey() || null,
                  validation_validation_id: oValidation.getSelectedKey() || null,
                  source_table: oSourceTable.getValue().trim() || null,
                  source_field: oSourceField.getValue().trim() || null,
                  active: oActiveSwitch.getState()
                };

                if (this._oViewModel.getProperty("/isNew")) {
                  this._stagePendingColumn(oPayload, oCtxBeingEdited ? oCtxBeingEdited.getProperty("column_name") : null);
                } else if (!oCtxBeingEdited) {
                  this._createGridColumn(oPayload);
                } else {
                  this._updateGridColumn(oCtxBeingEdited, oPayload);
                }

                this._oGridColumnDialog.close();
              }.bind(this)
            }),
            endButton: new Button({
              text: "Cancel",
              press: function () { this._oGridColumnDialog.close(); }.bind(this)
            })
          });
          this._oGridColumnDialog._oNameInput     = oNameInput;
          this._oGridColumnDialog._oDescInput     = oDescInput;
          this._oGridColumnDialog._oDataType      = oDataType;
          this._oGridColumnDialog._oLengthInput   = oLengthInput;
          this._oGridColumnDialog._oDecimalsInput = oDecimalsInput;
          this._oGridColumnDialog._oDisplayType   = oDisplayType;
          this._oGridColumnDialog._oValueTable    = oValueTable;
          this._oGridColumnDialog._oValidation    = oValidation;
          this._oGridColumnDialog._oLengthLabel   = oLengthLabel;
          this._oGridColumnDialog._oDecimalsLabel = oDecimalsLabel;
          this._oGridColumnDialog._oValueTableLabel = oValueTableLabel;
          this._oGridColumnDialog._oSourceTableLabel = oSourceTableLabel;
          this._oGridColumnDialog._oSourceFieldLabel = oSourceFieldLabel;
          this._oGridColumnDialog._oSourceTable   = oSourceTable;
          this._oGridColumnDialog._oSourceField   = oSourceField;
          this._oGridColumnDialog._oActiveSwitch  = oActiveSwitch;
          this.getView().addDependent(this._oGridColumnDialog);
        }

        var oD = this._oGridColumnDialog;
        oD._oEditingCtx = oExistingCtx;

        if (bEdit) {
          oD.setTitle("Edit Grid Column");
          oD.getBeginButton().setText("Save");
          oD._oNameInput.setValue(oExistingCtx.getProperty("column_name"));
          oD._oNameInput.setEditable(false);
          oD._oDescInput.setValue(oExistingCtx.getProperty("description"));
          oD._oDataType.setSelectedKey(oExistingCtx.getProperty("data_type"));
          oD._oLengthInput.setValue(oExistingCtx.getProperty("length") || "");
          oD._oDecimalsInput.setValue(oExistingCtx.getProperty("decimals") || "");
          oD._oDisplayType.setSelectedKey(oExistingCtx.getProperty("display_type"));
          oD._oValueTable.setSelectedKey(oExistingCtx.getProperty("value_table_value_table_id") || "");
          oD._oValidation.setSelectedKey(oExistingCtx.getProperty("validation_validation_id") || "");
          oD._oSourceTable.setValue(oExistingCtx.getProperty("source_table") || "");
          oD._oSourceField.setValue(oExistingCtx.getProperty("source_field") || "");
          oD._oActiveSwitch.setState(this._isGridColActive(oExistingCtx.getProperty("active")));
          oD._sPrevGridType = oExistingCtx.getProperty("data_type");
          this._syncGridDialog(false);
          oD._oDecimalsInput.setValue(oExistingCtx.getProperty("decimals") || "");
        } else {
          oD.setTitle("Add Grid Column");
          oD.getBeginButton().setText("Add");
          oD._oNameInput.setValue("");
          oD._oNameInput.setEditable(true);
          oD._oDescInput.setValue("");
          oD._oDataType.setSelectedKey("");
          oD._oLengthInput.setValue("");
          oD._oDecimalsInput.setValue("");
          oD._oDisplayType.setSelectedKey("");
          oD._oValueTable.setSelectedKey("");
          oD._oValidation.setSelectedKey("");
          oD._oSourceTable.setValue("");
          oD._oSourceField.setValue("");
          oD._oActiveSwitch.setState(true);
          oD._sPrevGridType = "";
          this._syncGridDialog(false);
        }

        oD.open();
      },

      _createGridColumn: function (oPayload) {
        var oTable = this.byId("gridColumnsTable");
        if (!oTable) { return; }
        var oListBinding = oTable.getBinding("items");
        if (!oListBinding) { return; }

        // Created through the table's own LIVE binding (relative to this
        // field's context), not a freshly manufactured bindList — field_id
        // is inherited implicitly from the grid_columns composition, same
        // pattern as ReleaseCodeUser rows under ReleaseCodeDetail.
        oListBinding.create(oPayload);

        var oModel = this.getOwnerComponent().getModel();
        oModel.submitBatch("gridColumnsUpdate")
          .then(function () {
            MessageToast.show("Grid column added.");
            this._loadGridColumnCount();
          }.bind(this))
          .catch(function (e) {
            MessageBox.error("Could not add grid column: " + (e.message || "Unknown error"));
          });
      },

      _updateGridColumn: function (oCtx, oPayload) {
        Object.keys(oPayload).forEach(function (sKey) {
          if (sKey === "column_name") { return; } // key field, not patchable
          oCtx.setProperty(sKey, oPayload[sKey]);
        });

        var oModel = this.getOwnerComponent().getModel();
        oModel.submitBatch("gridColumnsUpdate")
          .then(function () {
            MessageToast.show("Grid column updated.");
          }.bind(this))
          .catch(function (e) {
            MessageBox.error("Could not update grid column: " + (e.message || "Unknown error"));
          });
      },

      onDeleteGridColumn: function (oEvent) {
        // The row's own context from the table's live binding — not a
        // freshly built bindContext() — is what the model actually
        // tracks and can delete (same note as onDeleteUser above).
        var oRowCtx = oEvent.getSource().getBindingContext();
        var sName = oRowCtx.getProperty("column_name");

        MessageBox.confirm("Delete grid column \"" + sName + "\"?", {
          onClose: function (sAction) {
            if (sAction !== MessageBox.Action.OK) { return; }
            oRowCtx.delete("$auto")
              .then(function () {
                MessageToast.show("Grid column deleted.");
                this._loadGridColumnCount();
              }.bind(this))
              .catch(function (e) {
                MessageBox.error("Delete failed: " + (e.message || "Unknown error"));
              }.bind(this));
          }.bind(this)
        });
      },

      // ── Navigation ───────────────────────────────────────────────

      onNavBack: function () {
        this.getOwnerComponent().getRouter().navTo("fieldMaster");
      },

      onNavHome: function () {
        this.getOwnerComponent().getRouter().navTo("masterDataTypes");
      },
    });
  },
);