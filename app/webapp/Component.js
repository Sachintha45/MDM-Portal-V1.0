sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/odata/v4/ODataModel"
], function (UIComponent, ODataModel) {
    "use strict";

    // Update groups used by each detail screen. A failed Save leaves the new
    // record sitting in its group ("POST failed; will be repeated
    // automatically"), and it then shows up as a blank row in the list after you
    // leave the screen. Leaving a detail screen therefore discards whatever is
    // still pending in that screen's groups.
    var DETAIL_GROUPS = {
        validationRuleDetail   : ["validationUpdate", "validationLinks"],
        valueTableDetail       : ["valueTableUpdate"],
        fieldMasterDetail      : ["fieldMasterUpdate", "fieldUsageAssign"],
        accountGroupDetail     : ["accountGroupUpdate", "accountGroupFieldsCreate"],
        bpCategoryDetail       : ["bpCategoryUpdate"],
        bpRoleDetail           : ["bpRoleUpdate", "bpRoleFieldsCreate"],
        fieldGroupDetail       : ["fieldGroupUpdate", "subGroupCreate", "fieldGroupAssign", "fieldGroupRemove"],
        releaseCodeDetail      : ["releaseCodeUpdate", "releaseCodeUsersUpdate", "releaseCodeScopeUpdate"],
        releaseCriteriaDetail  : ["releaseCriteriaUpdate", "releaseCriteriaValuesUpdate"],
        releaseStrategyDetail  : ["releaseStrategyUpdate", "releaseStrategyValuesUpdate", "releaseStrategyStepsUpdate"]
    };

    return UIComponent.extend("mdm.portal.Component", {
        metadata: { manifest: "json" },
        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            var oRouter = this.getRouter();
            var sPrev = null;
            oRouter.attachRouteMatched(function (oEvent) {
                var sName = oEvent.getParameter("name");
                var aGroups = sPrev && sPrev !== sName && DETAIL_GROUPS[sPrev];
                if (aGroups) {
                    var oModel = this.getModel();
                    aGroups.forEach(function (sGroup) {
                        try { oModel.resetChanges(sGroup); } catch (e) { /* nothing pending */ }
                    });
                }
                sPrev = sName;
            }, this);
            oRouter.initialize();
        }
    });
});