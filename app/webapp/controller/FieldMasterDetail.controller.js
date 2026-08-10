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
      },

      // ── Lookup loader ────────────────────────────────────────────

      _loadLookups: function () {
        var oModel = this.getOwnerComponent().getModel();
        var oLookupsModel = new JSONModel({
          displayTypes: [],
          valueTables: [],
          validationRules: [],
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
          .requestContexts(0, 200)
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
                text:
                  c.getProperty("validation_id") +
                  " — " +
                  c.getProperty("function_name"),
              });
            });
            oLookupsModel.setProperty("/validationRules", aItems);
          });

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

        if (sFieldId === "NEW") {
          this._createNewField();
        } else {
          this._bindField(sFieldId);
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
              "display_type", "active", "grid", "grid_overview", "source_table", "source_field",
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
                grid_overview: false,
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
                grid_overview: false,
                source_table: "",
                source_field: "",
              });
              this.getView().unbindObject();
              this.getView().setBindingContext(oContext);
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

      // A field getting an Overview tab in Create BP is a separate,
      // explicit opt-in (grid_overview) — not inferred automatically from
      // Grid alone, since not every grid field needs a second view. The
      // toggle (visible="{grid}" in the view) is how the admin sets it, no
      // prompt. Switching Grid off clears it too, since it's meaningless
      // without Grid on.
      onGridSwitchChange: function (oEvent) {
        this.onFieldChange();
        if (!oEvent.getParameter("state")) {
          this.byId("swGridOverview").setState(false);
        }
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
        this._updateValueTablePreview(sKey ? { value_table_id: sKey } : null);
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
        var oCtx = oEvent.getSource().getBindingContext();
        var sRoleId = oCtx.getProperty("role_role_id");
        if (sRoleId) {
          this.getOwnerComponent()
            .getRouter()
            .navTo("bpRoleDetail", {
              roleId: encodeURIComponent(sRoleId.toLowerCase()),
            });
        }
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

        // A Dropdown or Search Help display type renders a value list — without a
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
        if (!bGrid && (sDisplayType === "DROPDOWN" || sDisplayType === "SEARCH_HELP") && !sValueTable) {
          MessageBox.error("A Value Table is required when Display Type is Dropdown or Search Help. Select one on the Value Help tab before saving.");
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
                  this._oViewModel.setProperty("/busy", false);
                  this._oViewModel.setProperty("/isDirty", false);
                  MessageToast.show("Field saved successfully.");

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
              grid_overview: oData.grid_overview,
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
        // Never attempt to load usage data for an unsaved new field.
        // The transient OData V4 context created by listBinding.create()
        // has field_id = "" at creation time, but between navigation and
        // the setBindingContext() call completing, getBindingContext() can
        // still return the *previous* field's context — causing _loadUsage
        // to query BPRoleFields with that stale field_id and showing the
        // previous field's role assignments on the new-field form.
        if (this._oViewModel.getProperty("/isNew")) {
          // Clear any stale data from a previous field's usage load
          var oUsageModel = this.getView().getModel("usage");
          if (oUsageModel) { oUsageModel.setProperty("/items", []); }
          this.byId("usageCount") && this.byId("usageCount").setText("0 role assignments");
          return;
        }

        var oCtx = this.getView().getBindingContext();
        if (!oCtx) {
          return;
        }
        var sFieldId = oCtx.getProperty("field_id");
        if (!sFieldId) {
          return;
        }

        var oTable = this.byId("usageTable");
        var oBinding = oTable.getBinding("items");
        if (!oBinding) {
          return;
        }

        oBinding.filter([
          new Filter("field_field_id", FilterOperator.EQ, sFieldId),
        ]);
        oBinding.attachEventOnce(
          "dataReceived",
          function () {
            var iCount = oBinding.getLength();
            this.byId("usageCount").setText(
              iCount + " role assignment" + (iCount !== 1 ? "s" : ""),
            );
          }.bind(this),
        );
      },

      _loadChangeLog: function () {
        var oCtx = this.getView().getBindingContext();
        if (!oCtx) { return; }
        var sFieldId = oCtx.getProperty("field_id");
        if (!sFieldId) { return; }

        // Populate managed-field strip
        var oVm = this._oViewModel;
        oVm.setProperty("/clCreatedAt",  this._fmtDate(oCtx.getProperty("createdAt")));
        oVm.setProperty("/clCreatedBy",  oCtx.getProperty("createdBy")  || "—");
        oVm.setProperty("/clModifiedAt", this._fmtDate(oCtx.getProperty("modifiedAt")));
        oVm.setProperty("/clModifiedBy", oCtx.getProperty("modifiedBy") || "—");

        var oTable = this.byId("logTable");
        var oBinding = oTable && oTable.getBinding("items");
        if (!oBinding) { return; }
        oBinding.filter([
          new Filter("entity_name", FilterOperator.EQ, "FieldMaster"),
          new Filter("entity_key",  FilterOperator.EQ, sFieldId),
        ]);
        oBinding.resume();
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
        if (this._oViewModel.getProperty("/isNew")) {
          MessageToast.show("Save this field first before adding grid columns.");
          return;
        }
        this._openGridColumnDialog(null);
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
            items: { path: "lookups>/dataTypes", template: new Item({ key: "{lookups>key}", text: "{lookups>text}" }) }
          });
          var oLengthInput   = new Input({ type: "Number", placeholder: "Max length" });
          var oDecimalsInput = new Input({ type: "Number", placeholder: "Decimal places" });
          var oValueTableLabel = new Label({ text: "Value Table" });
          var oValueTable    = new Select({
            width: "100%", forceSelection: false,
            items: { path: "lookups>/valueTables", template: new Item({ key: "{lookups>key}", text: "{lookups>text}" }) }
          });
          var oDisplayType  = new Select({
            width: "100%", forceSelection: false,
            items: { path: "lookups>/displayTypes", template: new Item({ key: "{lookups>key}", text: "{lookups>text}" }) },
            change: function () {
              var sType = oDisplayType.getSelectedKey();
              oValueTableLabel.setRequired(sType === "DROPDOWN" || sType === "SEARCH_HELP");
            }
          });
          var oValidation   = new Select({
            width: "100%", forceSelection: false,
            items: { path: "lookups>/validationRules", template: new Item({ key: "{lookups>key}", text: "{lookups>text}" }) }
          });
          var oSourceTable = new Input({ placeholder: "Source SAP table (optional)" });
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
                new Label({ text: "Length" }), oLengthInput,
                new Label({ text: "Decimals" }), oDecimalsInput,
                new Label({ text: "Display Type", required: true }), oDisplayType,
                oValueTableLabel, oValueTable,
                new Label({ text: "Validation Rule" }), oValidation,
                new Label({ text: "Source Table" }), oSourceTable,
                new Label({ text: "Source Field" }), oSourceField,
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
                if ((sDisplay === "DROPDOWN" || sDisplay === "SEARCH_HELP") && !oValueTable.getSelectedKey()) {
                  MessageBox.error("Display Type \"" + sDisplay + "\" requires a Value Table.");
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
                  length: oLengthInput.getValue() ? parseInt(oLengthInput.getValue(), 10) : null,
                  decimals: oDecimalsInput.getValue() ? parseInt(oDecimalsInput.getValue(), 10) : null,
                  display_type: sDisplay,
                  value_table_value_table_id: oValueTable.getSelectedKey() || null,
                  validation_validation_id: oValidation.getSelectedKey() || null,
                  source_table: oSourceTable.getValue().trim() || null,
                  source_field: oSourceField.getValue().trim() || null,
                  active: oActiveSwitch.getState()
                };

                if (!oCtxBeingEdited) {
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