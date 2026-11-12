sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "mdm/portal/util/ApprovalHelper"
], function (Controller, JSONModel, MessageBox, ApprovalHelper) {
    "use strict";

    return Controller.extend("mdm.portal.controller.MyApprovals", {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy         : false,
                rows         : [],
                // true on the "Completed 30d" chip: shows the decisions table
                showCompleted: false,
                statPending  : 0,
                statOverdue  : 0,
                statDueToday : 0,
                statCompleted: 0,
                noDataText   : "No pending approvals \u2014 you're all caught up."
            });
            this.getView().setModel(this._oViewModel, "view");

            // Full unfiltered row set (kept separately so stat-chip / search /
            // type filters can all be re-applied client-side without refetching)
            this._aAllRows = [];
            // My decisions of the last 30 days, one row per decision
            this._aCompletedRows = [];
            this._sStatFilter = "pending";

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("myApprovals").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._loadApprovals();
        },

        onRefresh: function () {
            this._loadApprovals();
        },

        // ── Load data ────────────────────────────────────────────────

        _loadApprovals: function () {
            var oVm = this._oViewModel;
            var oModel = this.getOwnerComponent().getModel();
            var that = this;

            oVm.setProperty("/busy", true);

            ApprovalHelper.getCurrentUserId(oModel)
                .then(function (sUserId) {
                    that._sUserId = sUserId;
                    return ApprovalHelper.getMyPendingApprovals(oModel, sUserId);
                })
                .then(function (aRows) {
                    return that._loadCompletedApprovals(oModel).then(function (aCompleted) {
                        // One pass over both lists — same release code lookup
                        return that._enrichWithReleaseCodeDescriptions(oModel, aRows.concat(aCompleted))
                            .then(function () {
                                return { rows: aRows, completed: aCompleted };
                            });
                    });
                })
                .then(function (oResult) {
                    var oNow = new Date();
                    var sTodayKey = oNow.toDateString();

                    oResult.rows.forEach(function (r) {
                        var oDue = r.due_at ? new Date(r.due_at) : null;
                        r.isOverdue = !!(oDue && oDue < oNow);
                        r.isDueToday = !!(oDue && !r.isOverdue && oDue.toDateString() === sTodayKey);
                    });

                    that._aAllRows = oResult.rows;
                    that._aCompletedRows = oResult.completed;

                    oVm.setProperty("/statPending",   oResult.rows.length);
                    oVm.setProperty("/statOverdue",   oResult.rows.filter(function (r) { return r.isOverdue; }).length);
                    oVm.setProperty("/statDueToday",  oResult.rows.filter(function (r) { return r.isDueToday; }).length);
                    oVm.setProperty("/statCompleted", oResult.completed.length);

                    that._applyFilters();
                    oVm.setProperty("/busy", false);
                })
                .catch(function (oErr) {
                    oVm.setProperty("/busy", false);
                    console.error("Could not load approvals inbox:", oErr);
                });
        },

        // Enriches each row's release_code_id with its description for the
        // "My Code" column (e.g. "02" \u2192 "02 \u2014 Sales Manager").
        _enrichWithReleaseCodeDescriptions: function (oModel, aRows) {
            if (!aRows.length) { return Promise.resolve(aRows); }
            var sBase = oModel.getServiceUrl().replace(/\/$/, "");

            return fetch(sBase + "/ReleaseCodes?$select=release_code_id,description&$top=200",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    var mDesc = {};
                    ((d && d.value) || []).forEach(function (c) {
                        mDesc[c.release_code_id] = c.description;
                    });
                    aRows.forEach(function (r) {
                        var sDesc = mDesc[r.release_code_id];
                        r.release_code_id = r.release_code_id + (sDesc ? " \u2014 " + sDesc : "");
                    });
                    return aRows;
                })
                .catch(function () { return aRows; });
        },

        // Decisions THIS user made in the last 30 days (newest first), one
        // row per decision, joined with the request's CURRENT status — so
        // the approver sees how it ended: still in approval, approved,
        // posted (with the BP number), posting failed, rejected, ...
        // A request decided twice (e.g. resubmitted after a failed
        // posting) shows up once per decision.
        _loadCompletedApprovals: function (oModel) {
            if (!this._sUserId) { return Promise.resolve([]); }
            var sBase  = oModel.getServiceUrl().replace(/\/$/, "");
            var sSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            var sUser  = encodeURIComponent(this._sUserId.replace(/'/g, "''"));

            function fetchJson(sUrl) {
                return fetch(sUrl, { headers: { Accept: "application/json" } })
                    .then(function (r) {
                        if (!r.ok) { throw new Error("HTTP " + r.status); }
                        return r.json();
                    })
                    .then(function (d) { return (d && d.value) || []; });
            }

            return fetchJson(sBase + "/CRApprovalDecisions?$filter=acted_by eq '" + sUser +
                "' and acted_at ge " + sSince +
                "&$select=cr_cr_id,step_number,release_code_release_code_id,action,acted_at,comment" +
                "&$orderby=acted_at desc&$top=500")
            .then(function (aDecisions) {
                if (!aDecisions.length) { return []; }

                var aCrIds = [];
                aDecisions.forEach(function (d) {
                    if (aCrIds.indexOf(d.cr_cr_id) < 0) { aCrIds.push(d.cr_cr_id); }
                });

                // Chunk the OR filter, same as ApprovalHelper.getMyPendingApprovals
                var aChunks = [];
                for (var i = 0; i < aCrIds.length; i += 40) {
                    aChunks.push(aCrIds.slice(i, i + 40));
                }
                return Promise.all(aChunks.map(function (aChunk) {
                    return fetchJson(sBase + "/ChangeRequests?$filter=(" +
                        aChunk.map(function (s) { return "cr_id eq '" + encodeURIComponent(s) + "'"; }).join(" or ") +
                        ")&$select=cr_id,request_type,master_data_type_master_data_type_id," +
                        "bp_category_category_id,account_group_account_group_id,reference_object_no," +
                        "requester,submitted_at,strategy_strategy_id,status,posted_object_no,posting_error" +
                        "&$top=500");
                })).then(function (aChunkResults) {
                    var mCrById = {};
                    [].concat.apply([], aChunkResults).forEach(function (cr) { mCrById[cr.cr_id] = cr; });

                    var mDecision = {
                        APPROVE  : { text: "Approved",  state: "Success" },
                        REJECT   : { text: "Rejected",  state: "Error" },
                        SEND_BACK: { text: "Sent Back", state: "Warning" }
                    };
                    var mStatus = {
                        DRAFT         : { text: "Draft",          state: "None" },
                        IN_APPROVAL   : { text: "In Approval",    state: "Warning" },
                        APPROVED      : { text: "Approved",       state: "Success" },
                        POSTED        : { text: "Posted",         state: "Success" },
                        POSTING_FAILED: { text: "Posting Failed", state: "Error" },
                        REJECTED      : { text: "Rejected",       state: "Error" },
                        SENT_BACK     : { text: "Sent Back",      state: "Warning" },
                        CANCELLED     : { text: "Cancelled",      state: "None" }
                    };

                    return aDecisions.map(function (d) {
                        var cr = mCrById[d.cr_cr_id] || {};
                        var oDec = mDecision[d.action] || { text: d.action || "", state: "None" };
                        var oSt  = mStatus[cr.status]  || { text: cr.status || "—", state: "None" };
                        return {
                            cr_id          : d.cr_cr_id,
                            request_type   : cr.request_type || "",
                            subject        : (cr.bp_category_category_id || cr.account_group_account_group_id ||
                                              cr.master_data_type_master_data_type_id || "") +
                                             (cr.reference_object_no ? " — " + cr.reference_object_no : ""),
                            requester      : cr.requester || "",
                            strategy_id    : cr.strategy_strategy_id || "",
                            step_number    : d.step_number,
                            release_code_id: d.release_code_release_code_id || "",
                            decisionText   : oDec.text,
                            decisionState  : oDec.state,
                            comment        : d.comment || "",
                            decided_at     : d.acted_at || null,
                            statusText     : cr.status === "POSTED" && cr.posted_object_no
                                ? "Posted · BP " + cr.posted_object_no
                                : oSt.text,
                            statusState    : oSt.state,
                            // POSTING_FAILED: the S/4 error, opened via "View error"
                            // (hasError also covers a failed CR with no stored text)
                            hasError       : cr.status === "POSTING_FAILED",
                            postingError   : cr.status === "POSTING_FAILED" ? (cr.posting_error || "") : ""
                        };
                    });
                });
            })
            .catch(function (oErr) {
                console.error("Could not load completed approvals:", oErr);
                return [];
            });
        },

        // Shows why S/4HANA rejected the posting of a request.
        onViewPostingError: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("view").getObject();
            MessageBox.error(
                "S/4HANA rejected the Business Partner posting:\n\n" +
                (oRow.postingError || "No error details were recorded."),
                { title: "Posting Failed — " + oRow.cr_id });
        },

        // Date + time in the user's locale; "" when empty.
        formatDateTime: function (vDate) {
            if (!vDate) { return ""; }
            var oDate = new Date(vDate);
            return isNaN(oDate.getTime()) ? "" : oDate.toLocaleString();
        },

        // ── Filters ──────────────────────────────────────────────────

        onStatFilterChange: function (oEvent) {
            this._sStatFilter = oEvent.getParameter("key");
            this._applyFilters();
        },

        onFilterChange: function () {
            this._applyFilters();
        },

        onSearch: function () {
            this._applyFilters();
        },

        _applyFilters: function () {
            var oVm = this._oViewModel;
            var sType = this.byId("selApType") ? this.byId("selApType").getSelectedKey() : "";
            var sQuery = this.byId("apSearch") ? this.byId("apSearch").getValue().toLowerCase() : "";

            var aRows = this._aAllRows;
            var bCompleted = this._sStatFilter === "completed";
            oVm.setProperty("/showCompleted", bCompleted);

            if (this._sStatFilter === "overdue") {
                aRows = aRows.filter(function (r) { return r.isOverdue; });
            } else if (this._sStatFilter === "dueToday") {
                aRows = aRows.filter(function (r) { return r.isDueToday; });
            } else if (bCompleted) {
                // Shown in the separate apCompletedTable, which has its own
                // columns: my decision, when, and how the request ended.
                aRows = this._aCompletedRows;
                oVm.setProperty("/noDataText", "You haven't made any approval decisions in the last 30 days.");
            } else {
                oVm.setProperty("/noDataText", "No pending approvals \u2014 you're all caught up.");
            }

            if (sType) {
                aRows = aRows.filter(function (r) { return r.request_type === sType; });
            }
            if (sQuery) {
                aRows = aRows.filter(function (r) {
                    return (r.cr_id || "").toLowerCase().indexOf(sQuery) >= 0 ||
                        (r.statusText || "").toLowerCase().indexOf(sQuery) >= 0 ||
                        (r.subject || "").toLowerCase().indexOf(sQuery) >= 0 ||
                        (r.requester || "").toLowerCase().indexOf(sQuery) >= 0;
                });
            }

            oVm.setProperty("/rows", aRows);
        },

        // ── Navigation ───────────────────────────────────────────────

        onRowPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("view");
            if (!oCtx) { return; }
            var oRow = oCtx.getObject();
            this.getOwnerComponent().getRouter().navTo("approvalDetail", {
                crId: encodeURIComponent(oRow.cr_id),
                stepNumber: oRow.step_number
            });
        },

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("home", {}, true);
        }
    });
});