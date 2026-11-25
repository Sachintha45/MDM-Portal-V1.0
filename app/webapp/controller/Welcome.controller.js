sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "mdm/portal/util/ApprovalHelper"
], function (Controller, JSONModel, ApprovalHelper) {
    "use strict";

    var DAY = 24 * 60 * 60 * 1000;

    function _fetchJson(sUrl) {
        return fetch(sUrl, { headers: { Accept: "application/json" } })
            .then(function (r) { return r.json(); })
            .then(function (d) { return (d && d.value !== undefined) ? d.value : []; })
            .catch(function () { return []; });
    }

    return Controller.extend("mdm.portal.controller.Welcome", {

        onInit: function () {
            this.getView().setModel(new JSONModel({
                busy: false,
                greeting: "Welcome",
                subtitle: "",
                isApprover: false,
                kpi: { pending: "0", pendingNote: "", open: "0", openNote: "",
                       returned: "0", returnedNote: "", posted: "0", postedNote: "" },
                actions: [],
                activity: []
            }), "home");

            // reload every time Home is shown, so the numbers are never stale
            this.getOwnerComponent().getRouter().getRoute("home")
                .attachPatternMatched(this._load, this);
        },

        // ── Greeting ──────────────────────────────────────────────────
        // "Good morning / afternoon / evening, <first name>" — just "Welcome"
        // when no usable name can be worked out from the login.
        _firstName: function (sUserId) {
            if (!sUserId || sUserId === "anonymous") { return ""; }
            var sFirst = String(sUserId).split("@")[0].split(/[._\-\s]+/)[0] || "";
            if (!/^[A-Za-zÀ-ɏ]{2,}$/.test(sFirst)) { return ""; }
            return sFirst.charAt(0).toUpperCase() + sFirst.slice(1).toLowerCase();
        },

        _greeting: function (sUserId) {
            var iHour = new Date().getHours();
            var sPart = iHour < 12 ? "Good morning" : (iHour < 17 ? "Good afternoon" : "Good evening");
            var sName = this._firstName(sUserId);
            return sName ? sPart + ", " + sName : "Welcome";
        },

        _ago: function (sIso) {
            if (!sIso) { return ""; }
            var iMin = Math.round((Date.now() - new Date(sIso).getTime()) / 60000);
            if (iMin < 1)  { return "just now"; }
            if (iMin < 60) { return iMin + " min ago"; }
            var iHr = Math.round(iMin / 60);
            if (iHr < 24)  { return iHr + " hr ago"; }
            var iDay = Math.round(iHr / 24);
            return iDay + " day" + (iDay === 1 ? "" : "s") + " ago";
        },

        _plural: function (n, s) { return n + " " + s + (n === 1 ? "" : "s"); },

        // ── Data ──────────────────────────────────────────────────────
        _load: function () {
            var oModel  = this.getOwnerComponent().getModel();
            var oHome   = this.getView().getModel("home");
            var sBase   = oModel.getServiceUrl().replace(/\/$/, "");
            oHome.setProperty("/busy", true);

            ApprovalHelper.getCurrentUserId(oModel).then(function (sUserId) {
                oHome.setProperty("/greeting", this._greeting(sUserId));
                var sUser = encodeURIComponent(String(sUserId).replace(/'/g, "''"));

                var pMine = _fetchJson(sBase + "/ChangeRequests?$filter=requester eq '" + sUser + "'" +
                    "&$select=cr_id,request_type,status,reference_object_no,posted_at,submitted_at,modifiedAt," +
                    "master_data_type_master_data_type_id,bp_category_category_id" +
                    "&$orderby=modifiedAt desc&$top=300");
                var pCodes = _fetchJson(sBase + "/ReleaseCodeUsers?$filter=user_id eq '" + sUser +
                    "' and active eq true&$select=release_code_release_code_id&$top=50");

                return Promise.all([
                    ApprovalHelper.getMyPendingApprovals(oModel, sUserId).catch(function () { return []; }),
                    pMine,
                    pCodes,
                    ApprovalHelper.getMyNotifications(oModel, sUserId, 6).catch(function () { return []; })
                ]);
            }.bind(this)).then(function (a) {
                this._fill(a[0] || [], a[1] || [], a[2] || [], a[3] || []);
            }.bind(this)).catch(function () {
                /* leave the page with its defaults */
            }).then(function () {
                oHome.setProperty("/busy", false);
            });
        },

        _label: function (r) {
            var sType = r.request_type === "CHANGE" ? "Change" : (r.request_type === "CREATE" ? "Create" : (r.request_type || ""));
            var sWhat = r.bp_category_category_id || r.master_data_type_master_data_type_id || "";
            return r.cr_id + (sType ? " · " + sType : "") + (sWhat ? " · " + sWhat : "");
        },

        _fill: function (aPending, aMine, aCodes, aNotifs) {
            var oHome = this.getView().getModel("home");
            var iNow  = Date.now();

            var iOld = aPending.filter(function (p) {
                return p.submitted_at && (iNow - new Date(p.submitted_at).getTime()) > 2 * DAY;
            }).length;

            var aOpen     = aMine.filter(function (r) { return r.status === "DRAFT" || r.status === "IN_APPROVAL"; });
            var iInAppr   = aOpen.filter(function (r) { return r.status === "IN_APPROVAL"; }).length;
            var aReturned = aMine.filter(function (r) { return r.status === "SENT_BACK" || r.status === "REJECTED"; });
            var iWeek     = aMine.filter(function (r) { return r.status === "POSTED" && r.posted_at && (iNow - new Date(r.posted_at).getTime()) <= 7 * DAY; }).length;
            var iPrev     = aMine.filter(function (r) {
                var t = r.posted_at ? iNow - new Date(r.posted_at).getTime() : 0;
                return r.status === "POSTED" && t > 7 * DAY && t <= 14 * DAY;
            }).length;

            oHome.setProperty("/isApprover", aPending.length > 0 || aCodes.length > 0);
            oHome.setProperty("/kpi", {
                pending: String(aPending.length),
                pendingNote: iOld ? iOld + " older than 2 days" : "",
                open: String(aOpen.length),
                openNote: iInAppr + " in approval, " + (aOpen.length - iInAppr) + " draft",
                returned: String(aReturned.length),
                returnedNote: aReturned.length ? "Needs your correction" : "",
                posted: String(iWeek),
                postedNote: (iWeek - iPrev >= 0 ? "+" : "") + (iWeek - iPrev) + " vs last week"
            });

            // Needs your action: approvals first (oldest waiting first), then fixes
            var aActions = aPending.slice().sort(function (x, y) {
                return new Date(x.submitted_at || 0) - new Date(y.submitted_at || 0);
            }).map(function (p) {
                return {
                    kind: "approve", cr_id: p.cr_id, step_number: p.step_number,
                    title: this._label(p),
                    description: (p.requester ? "Submitted by " + p.requester + " · " : "") + this._ago(p.submitted_at),
                    tag: "Approve", tagState: "Warning"
                };
            }.bind(this)).concat(aReturned.map(function (r) {
                return {
                    kind: "fix", cr_id: r.cr_id,
                    title: this._label(r),
                    description: (r.status === "REJECTED" ? "Rejected" : "Returned for changes") + " · " + this._ago(r.modifiedAt),
                    tag: "Fix", tagState: "Error"
                };
            }.bind(this)));
            oHome.setProperty("/actions", aActions.slice(0, 8));

            var iTodo = aPending.length;
            oHome.setProperty("/subtitle", iTodo
                ? "You have " + this._plural(iTodo, "request") + " waiting for your decision."
                : (aReturned.length
                    ? this._plural(aReturned.length, "request") + " need your correction."
                    : "You are all caught up."));

            oHome.setProperty("/activity", aNotifs.map(function (n) {
                return { cr_id: n.cr_cr_id || "", title: n.subject || n.event_type || "", when: this._ago(n.createdAt) };
            }.bind(this)));
        },

        // ── Navigation ────────────────────────────────────────────────
        onCreateBp: function () {
            this.getOwnerComponent().getRouter().navTo("createBP");
        },

        onKpiPress: function (oEvent) {
            var sRoute = oEvent.getSource().data("route");
            if (sRoute) { this.getOwnerComponent().getRouter().navTo(sRoute); }
        },

        onActionPress: function (oEvent) {
            var o = oEvent.getSource().getBindingContext("home").getObject();
            var oRouter = this.getOwnerComponent().getRouter();
            if (o.kind === "approve") {
                oRouter.navTo("approvalDetail", { crId: encodeURIComponent(o.cr_id), stepNumber: o.step_number });
            } else {
                oRouter.navTo("myRequestDetail", { crId: encodeURIComponent(o.cr_id) });
            }
        },

        onActivityPress: function (oEvent) {
            var o = oEvent.getSource().getBindingContext("home").getObject();
            if (o.cr_id) {
                this.getOwnerComponent().getRouter().navTo("myRequestDetail", { crId: encodeURIComponent(o.cr_id) });
            }
        }
    });
});