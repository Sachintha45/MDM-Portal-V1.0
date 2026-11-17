sap.ui.define([
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (MessageBox, MessageToast) {
    "use strict";

    /**
     * Inline editing of the uploaded value list rows of ONE table.
     * Mixed into ValueListUpload and ValueTableDetail so both screens edit
     * the same data in the same way.
     *
     * The host controller provides  _vlCtx()  returning
     *   { model : JSONModel holding {items:[...]},   // rows shown in the table
     *     table : "T005",                             // table being edited
     *     reload: function () -> Promise }            // reloads rows afterwards
     * and a view model (this._oViewModel) used for the "editMode" flag.
     *
     * Save sends the whole edited row set to UploadValueList (REPLACE) for that
     * single table, so Area is validated against the master data types and the
     * line numbers are renumbered in the order shown.
     */
    return {

        onVlEdit: function () {
            var c = this._vlCtx();
            // snapshot so Cancel can restore without a server round trip
            this._vlSnapshot = JSON.parse(JSON.stringify(c.model.getProperty("/items") || []));
            this._oViewModel.setProperty("/editMode", true);
        },

        onVlAddRow: function () {
            var c = this._vlCtx();
            var a = c.model.getProperty("/items").slice();
            a.push({ line_no: "", area: "", field_value_1: "", field_value_2: "",
                     field_value_3: "", field_value_4: "", field_value_5: "" });
            c.model.setProperty("/items", a);
        },

        onVlDeleteRow: function (oEvent) {
            var c = this._vlCtx();
            var oCtx = oEvent.getSource().getBindingContext(c.modelName);
            var iIdx = parseInt(oCtx.getPath().split("/").pop(), 10);
            var a = c.model.getProperty("/items").slice();
            a.splice(iIdx, 1);
            c.model.setProperty("/items", a);
        },

        onVlCancel: function () {
            var c = this._vlCtx();
            c.model.setProperty("/items", this._vlSnapshot || []);
            this._oViewModel.setProperty("/editMode", false);
        },

        onVlSave: function () {
            var c = this._vlCtx();
            if (!c.table) { return; }
            var aRows = [];
            (c.model.getProperty("/items") || []).forEach(function (r) {
                var aVals = [r.field_value_1, r.field_value_2, r.field_value_3, r.field_value_4, r.field_value_5];
                if (!aVals.some(function (v) { return v && String(v).trim(); })) { return; }   // blank row
                aRows.push({
                    table_name: c.table,
                    area: (r.area || "").trim(),
                    field_value_1: r.field_value_1 || "", field_value_2: r.field_value_2 || "",
                    field_value_3: r.field_value_3 || "", field_value_4: r.field_value_4 || "",
                    field_value_5: r.field_value_5 || ""
                });
            });
            if (!aRows.length) {
                MessageBox.error("There are no rows to save. To remove all data of " + c.table +
                    ", use the delete button on the Value List Upload page.");
                return;
            }
            this._oViewModel.setProperty("/busy", true);
            var oOp = this.getOwnerComponent().getModel().bindContext("/UploadValueList(...)");
            oOp.setParameter("mode", "REPLACE");
            oOp.setParameter("rows", aRows);
            oOp.setParameter("tables", []);
            oOp.execute("$direct").then(function () {
                MessageToast.show(aRows.length + " row(s) saved for " + c.table + ".");
                this._oViewModel.setProperty("/editMode", false);
                return c.reload();
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not save: " + ((e && e.message) || "Unknown error"));
            }).then(function () {
                this._oViewModel.setProperty("/busy", false);
            }.bind(this));
        }
    };
});