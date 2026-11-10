sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "mdm/portal/util/ApprovalHelper",
    "sap/m/Popover",
    "sap/m/VBox",
    "sap/m/Title",
    "sap/m/Text"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, Fragment, ApprovalHelper,
    Popover, VBox, Title, Text) {
    "use strict";
 
    // Maps route key → breadcrumb text shown in ShellBar secondTitle
    var mRouteLabels = {
        home: "Home",
        fieldMaster: "Fields \u203a Field Master",
        fieldMasterDetail: "Fields \u203a Field Master",
        validationRules: "Fields \u203a Validation Rules",
        validationRuleDetail: "Fields \u203a Validation Rules",
        valueTables: "Fields \u203a Value Tables",
        valueTableDetail: "Fields \u203a Value Tables",
        fieldGroups: "Fields \u203a Field Groups",
        fieldGroupDetail: "Fields \u203a Field Groups",
        bpCategories: "Business Partner \u203a BP Categories",
        bpCategoryDetail: "Business Partner \u203a BP Categories",
        bpRoles: "Business Partner \u203a BP Roles",
        bpRoleDetail: "Business Partner \u203a BP Roles",
        accountGroups: "Business Partner \u203a Account Groups",
        accountGroupDetail: "Business Partner \u203a Account Groups",
        releaseCriteria: "Release Strategy \u203a Release Criteria",
        releaseCodes: "Release Strategy \u203a Release Codes",
        releaseStrategies: "Release Strategy \u203a Release Strategies",
        createBP      : "BP Maintenance \u203a Create BP",
        createBPEdit  : "BP Maintenance \u203a Edit Draft",
        myRequests    : "BP Maintenance \u203a My Requests",
        myRequestDetail: "BP Maintenance \u203a My Requests",
        myApprovals   : "BP Maintenance \u203a My Approvals",
        approvalDetail: "BP Maintenance \u203a My Approvals",
        authRoles: "Authorizations \u203a Authorization Roles",
        users: "Authorizations \u203a Users",
        help: "Help",
        appSettings: "Settings"
    };
 
    return Controller.extend("mdm.portal.controller.App", {
 
        onInit: function () {
            var oUiModel = new JSONModel({
                pendingApprovals: 0,
                shellBreadcrumb: mRouteLabels.fieldMaster,
                userId: "",
                userInitials: "?"
            });
            this.getView().setModel(oUiModel, "ui");
            this._loadPendingApprovalCount();
            this._loadCurrentUser();
 
            // The breadcrumb was previously only updated from onNavItemSelect,
            // so it only changed when a side-nav item was clicked directly.
            // Any other navigation — opening a row from a list, a link inside a
            // detail page, browser back/forward, a deep link — left it stuck on
            // whatever it was last set to. Hooking the router's own
            // routeMatched event covers every navigation path uniformly.
            this.getOwnerComponent().getRouter()
                .attachRouteMatched(this._onAnyRouteMatched, this);
 
            // Correct the content margin after initial render
            setTimeout(function () {
                this._adjustContentWidth();
                this._fixClipPath();
            }.bind(this), 500);
 
            setTimeout(function () {
                var oToolPage = this.byId("toolPage");
                if (!oToolPage) return;
                var oToolPageDom = oToolPage.getDomRef();
                if (!oToolPageDom) return;
 
                // Observe the whole ToolPage subtree. Pages are created and
                // destroyed by routing, so watching a single wrapper found at
                // startup misses pages navigated to later. On any style/child
                // change, strip clip-path from every DynamicPage wrapper.
                var fnStrip = this._fixClipPath.bind(this);
                var oObserver = new MutationObserver(function () {
                    fnStrip();
                });
 
                oObserver.observe(oToolPageDom, {
                    attributes: true,
                    attributeFilter: ["style"],
                    subtree: true,
                    childList: true
                });
 
                this._oClipPathObserver = oObserver;
                // Run once now in case a page is already rendered
                fnStrip();
            }.bind(this), 600);
        },
        _adjustContentWidth: function () {
            var oToolPage = this.byId("toolPage");
            if (!oToolPage) return;
            var oToolPageDom = oToolPage.getDomRef();
            if (!oToolPageDom) return;
 
            var oSideContent = oToolPageDom.querySelector(".sapTntToolPageSideContent");
            var oMainContent = oToolPageDom.querySelector(".sapTntToolPageMainContent");
            if (!oMainContent) return;
 
            var iSideWidth = oSideContent
                ? oSideContent.getBoundingClientRect().width : 0;
 
            oMainContent.style.marginLeft = iSideWidth + "px";
            oMainContent.style.width = "calc(100% - " + iSideWidth + "px)";
 
            // Fire resize so SAP Table re-evaluates demandPopin columns
            window.dispatchEvent(new Event("resize"));
 
            // Invalidate the current page's table (id differs per page:
            // fieldTable / groupTable / valueTable / ruleTable) so columns
            // recalculate after the side nav toggles.
            var oNavContainer = this.byId("appPages");
            if (oNavContainer) {
                var oPage = oNavContainer.getCurrentPage();
                if (oPage && oPage.findAggregatedObjects) {
                    var aTables = oPage.findAggregatedObjects(true, function (oCtrl) {
                        return oCtrl.isA && oCtrl.isA("sap.m.Table");
                    });
                    aTables.forEach(function (oTable) { oTable.invalidate(); });
                }
            }
        },
 
        // ── Pending approval count (ShellBar notification badge) ───────
        // Uses the same ApprovalHelper.getMyPendingApprovals logic as the
        // My Approvals inbox, so the badge count and the inbox list always
        // agree on what's actionable right now.
        _loadPendingApprovalCount: function () {
            var oModel  = this.getOwnerComponent().getModel();
            var oUiModel = this.getView().getModel("ui");
 
            ApprovalHelper.getCurrentUserId(oModel)
                .then(function (sUserId) {
                    return ApprovalHelper.getMyPendingApprovals(oModel, sUserId);
                })
                .then(function (aRows) {
                    oUiModel.setProperty("/pendingApprovals", aRows.length);
                })
                .catch(function (oErr) {
                    console.warn("Could not load pending approvals", oErr);
                    oUiModel.setProperty("/pendingApprovals", 0);
                });
        },
 
        // ── ShellBar breadcrumb helper ──────────────────────────────────
        _onAnyRouteMatched: function (oEvent) {
            // Keep the ShellBar badge current: any navigation (e.g. after
            // submitting a request or recording a decision) re-counts.
            this._loadPendingApprovalCount();
            this._setShellBreadcrumb(oEvent.getParameter("name"));
        },
        _setShellBreadcrumb: function (sKey) {
            var sLabel = mRouteLabels[sKey] || sKey;
            this.getView().getModel("ui").setProperty("/shellBreadcrumb", sLabel);
        },
        // ── Navigation item select ──────────────────────────────────────
        onNavItemSelect: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            if (!oItem) return;
 
            // Explicitly move focus away from the nav item BEFORE navigating.
            // This prevents the aria-hidden conflict: when UI5 collapses a
            // NavigationListItem group it sets aria-hidden on it, but if a
            // child anchor still has focus the browser fires an accessibility
            // warning ("Blocked aria-hidden on a focused element").
            // Moving focus to the body first ensures the element is no longer
            // focused when UI5 sets aria-hidden on it.
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }
 
            var sKey = oItem.getKey();
            if (sKey) {
                var oRouter = this.getOwnerComponent().getRouter();
                if (oRouter.getRoute(sKey)) {
                    oRouter.navTo(sKey);
                } else {
                    MessageToast.show(oItem.getText() + " \u2014 coming soon");
                }
            }
 
            // Auto-collapse on Phone after selection
            if (sap.ui.Device.system.phone) {
                this.byId("toolPage").setSideExpanded(false);
            }
        },
        onHomePress: function () {
            this.getOwnerComponent().getRouter().navTo("home");
        },
        onSideNavToggle: function () {
            var oToolPage = this.byId("toolPage");
            oToolPage.setSideExpanded(!oToolPage.getSideExpanded());
 
            // Wait for SAP animation to finish then remeasure
            setTimeout(function () {
                this._adjustContentWidth();
                this._fixClipPath();
            }.bind(this), 300);
        },
        // ── Remove SAP's clip-path inline style that hides content ──────
        _fixClipPath: function () {
            var oToolPage = this.byId("toolPage");
            if (!oToolPage) return;
            var oToolPageDom = oToolPage.getDomRef();
            if (!oToolPageDom) return;
 
            // Target EVERY DynamicPage content wrapper currently in the DOM,
            // so the fix works for FieldMaster, FieldGroups, ValueTables,
            // ValidationRules — whichever page is showing.
            var aWrappers = oToolPageDom.querySelectorAll(
                "[id$='-contentWrapper'], .sapFDynamicPageContentWrapper"
            );
            aWrappers.forEach(function (oWrapper) {
                if (oWrapper.style.clipPath && oWrapper.style.clipPath !== "none") {
                    oWrapper.style.clipPath = "none";
                }
                oWrapper.style.overflow = "auto";
            });
        },
        // ── ShellBar search icon pressed ────────────────────────────────
        onSearchOpen: function () {
            // ShellBar handles its own search overlay; stub for custom logic
        },
 
        // ── Notifications ───────────────────────────────────────────────
        // Lazy-loads the popover fragment on first press and caches it —
        // same pattern used elsewhere in this app for on-demand dialogs.
        // Maps event_type -> NotificationListItem priority purely for the
        // colored accent bar (REJECTED reads as more urgent than APPROVED),
        // and formats createdAt into something readable. No read/unread
        // tracking — see the fragment's own comment for why.
        onNotificationsPress: function (oEvent) {
            var oView = this.getView();
            if (this._pNotificationsPopover) {
                this._loadNotifications();
                this._pNotificationsPopover.then(function (oPopover) {
                    oPopover.openBy(this.byId("shellBar"));
                }.bind(this));
                return;
            }
            this._pNotificationsPopover = Fragment.load({
                id: oView.getId(),
                name: "mdm.portal.view.Fragment.NotificationsPopover",
                controller: this
            }).then(function (oPopover) {
                oView.addDependent(oPopover);
                oPopover.setModel(new JSONModel({ items: [], pending: [] }), "notif");
                this._loadNotifications();
                oPopover.openBy(this.byId("shellBar"));
                return oPopover;
            }.bind(this));
        },
 
        _loadNotifications: function () {
            var oModel = this.getOwnerComponent().getModel();
            var that = this;
            ApprovalHelper.getCurrentUserId(oModel).then(function (sUserId) {
                // Pending approvals (same source as the badge) + activity log,
                // loaded independently so one failing doesn't blank the other.
                var pPending = ApprovalHelper.getMyPendingApprovals(oModel, sUserId)
                    .catch(function (e) { console.warn("[Notif] pending approvals failed", e); return []; });
                var pLog = ApprovalHelper.getMyNotifications(oModel, sUserId, 20)
                    .catch(function (e) { console.warn("Could not load notifications", e); return []; });
                return Promise.all([pPending, pLog]);
            }).then(function (aRes) {
                console.log("[Notif] pending rows:", aRes[0].length, aRes[0], "| activity rows:", aRes[1].length, aRes[1]);
                var mPriority = {
                    REJECTED: "High", SENT_BACK: "Medium", ASSIGNED: "Medium",
                    APPROVED: "Low", ESCALATED: "High", POSTED: "Low", POSTING_FAILED: "High"
                };
                var aPending = aRes[0].map(function (r) {
                    var aDesc = [];
                    if (r.requester)         { aDesc.push("Requested by " + r.requester); }
                    if (r.release_code_id)   { aDesc.push("Release code " + r.release_code_id); }
                    if (r.step_number)       { aDesc.push("Step " + r.step_number); }
                    return {
                        cr_id      : r.cr_id,
                        step_number: r.step_number,
                        title      : "CR " + r.cr_id + (r.subject ? " \u2014 " + r.subject : ""),
                        body       : aDesc.join(" \u00B7 "),
                        displayDate: that._formatNotificationDate(r.submitted_at),
                        priority   : r.due_at && new Date(r.due_at) < new Date() ? "High" : "Medium"
                    };
                });
                // An ASSIGNED notification for a CR that is still waiting in the
                // pending section is the same information twice - hide it there.
                var mPendingCr = {};
                aRes[0].forEach(function (r) { mPendingCr[r.cr_id] = true; });
                var aLog = aRes[1].filter(function (n) {
                    return !(n.event_type === "ASSIGNED" && mPendingCr[n.cr_cr_id]);
                });
                var aItems = aLog.map(function (n) {
                    return {
                        notification_id: n.notification_id,
                        cr_id       : n.cr_cr_id || "",
                        subject     : n.subject || "",
                        body        : n.body || "",
                        priority    : mPriority[n.event_type] || "None",
                        displayDate : that._formatNotificationDate(n.sent_at || n.createdAt)
                    };
                });
                // Opening the popover also corrects the badge to the fresh count.
                that.getView().getModel("ui").setProperty("/pendingApprovals", aPending.length);
                that._pNotificationsPopover.then(function (oPopover) {
                    var oM = oPopover.getModel("notif");
                    oM.setProperty("/pending", aPending);
                    oM.setProperty("/items", aItems);
                });
            }).catch(function (oErr) {
                console.error("[Notif] popover load failed", oErr);
            });
        },

        // Pending approval row -> straight into the approval step.
        onPendingItemPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("notif");
            if (!oCtx) { return; }
            var o = oCtx.getObject();
            this._pNotificationsPopover.then(function (oPopover) { oPopover.close(); });
            this.getOwnerComponent().getRouter().navTo("approvalDetail", {
                crId: encodeURIComponent(o.cr_id),
                stepNumber: o.step_number
            });
        },

        _formatNotificationDate: function (vDate) {
            if (!vDate) { return ""; }
            var oDate = new Date(vDate);
            if (isNaN(oDate.getTime())) { return ""; }
            var iDiffMs = Date.now() - oDate.getTime();
            var iDiffMin = Math.round(iDiffMs / 60000);
            if (iDiffMin < 1) { return "just now"; }
            if (iDiffMin < 60) { return iDiffMin + " min ago"; }
            var iDiffHr = Math.round(iDiffMin / 60);
            if (iDiffHr < 24) { return iDiffHr + " hr ago"; }
            var iDiffDay = Math.round(iDiffHr / 24);
            if (iDiffDay < 7) { return iDiffDay + " day" + (iDiffDay === 1 ? "" : "s") + " ago"; }
            return oDate.toLocaleDateString();
        },
 
        // Clicking a notification takes you to the related CR — same
        // detail page whether the notification was an assignment or a
        // decision, since Notification doesn't carry step_number to route
        // straight into a specific approval step.
        onNotificationItemPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("notif");
            var sCrId = oCtx && oCtx.getProperty("cr_id");
            this._pNotificationsPopover.then(function (oPopover) { oPopover.close(); });
            if (!sCrId) { return; }
            this.getOwnerComponent().getRouter().navTo("myRequestDetail", { crId: sCrId });
        },
        onExit: function () {
            if (this._oClipPathObserver) {
                this._oClipPathObserver.disconnect();
            }
        },
        // ── User avatar / profile ───────────────────────────────────────
 
        // Resolves the logged-in user (same getCurrentUser() function used
        // elsewhere for approval routing) and derives the two-letter
        // initials shown on the ShellBar avatar — previously hardcoded to
        // "RJ" regardless of who was actually logged in.
        _loadCurrentUser: function () {
            var oUiModel = this.getView().getModel("ui");
            var oModel = this.getOwnerComponent().getModel();
 
            ApprovalHelper.getCurrentUserId(oModel).then(function (sUserId) {
                oUiModel.setProperty("/userId", sUserId);
                oUiModel.setProperty("/userInitials", this._deriveInitials(sUserId));
            }.bind(this));
        },
 
        // "geethagini.sivamoorthy@intellectconsulting.io" -> "GS" (first
        // letter of each dot/underscore/hyphen-separated part of the email's
        // local part — matches how every seeded user id in this app is
        // formatted: firstname.lastname@...). Falls back sensibly for
        // anything that doesn't fit that shape rather than showing nothing.
        _deriveInitials: function (sUserId) {
            if (!sUserId || sUserId === "anonymous") { return "?"; }
            var sLocalPart = sUserId.split("@")[0];
            var aParts = sLocalPart.split(/[._-]+/).filter(Boolean);
            if (aParts.length >= 2) {
                return (aParts[0].charAt(0) + aParts[1].charAt(0)).toUpperCase();
            }
            if (aParts.length === 1 && aParts[0]) {
                return aParts[0].substring(0, 2).toUpperCase();
            }
            return "?";
        },
 
        onAvatarPress: function (oEvent) {
            if (!this._oUserPopover) {
                this._oUserPopover = new Popover({
                    placement: "Bottom",
                    showHeader: false,
                    contentWidth: "16rem",
                    content: [
                        new VBox({
                            class: "sapUiSmallMargin",
                            items: [
                                new Title({ text: "Signed in as", level: "H6" }),
                                new Text({
                                    text: "{ui>/userId}",
                                    class: "sapUiTinyMarginTop"
                                })
                            ]
                        })
                    ]
                });
                this.getView().addDependent(this._oUserPopover);
            }
            this._oUserPopover.openBy(oEvent.getSource());
        }
    });
});