// =============================================================================
//  SAP MDM Portal — S/4HANA Integration Service
//
//  Everything that talks to S/4HANA lives in this one file, so
//  mdm-service.js only decides WHEN to integrate (e.g. on final approval)
//  and what to do with the result — never how the call itself is made.
//
//  Business Partner maintenance through S/4's standard
//  API_BUSINESS_PARTNER OData V2 service (SAP Business Accelerator Hub):
//
//    createBusinessPartner(cr)           CREATE request → new BP, returns its number
//    updateBusinessPartner(cr)           CHANGE / EXTEND request → updates the
//                                        existing BP, adds roles, company codes,
//                                        sales areas, purchasing orgs …
//    markBusinessPartnerForDeletion(cr)  DELETE request → sets the BP's
//                                        archiving flag + customer/supplier
//                                        deletion indicators
//    readBusinessPartner(bp, expand)     reads one BP with its child data
//    buildBusinessPartnerPayload()       CR data → A_BusinessPartner payload
//                                        (pure — no DB or HTTP access)
//    extractS4Error(err)                 readable message from a failed S/4 call
//
//  All of them throw on failure — the caller (_postApprovedCr in
//  mdm-service.js) records the outcome on the change request.
//
//  The S/4 connection itself is configured in package.json under
//  cds.requires.API_BUSINESS_PARTNER (destination + service path).
// =============================================================================

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

// Name of the cds.requires entry in package.json that points at S/4HANA.
const S4_BP_SERVICE = 'API_BUSINESS_PARTNER';

// BPCategory.category_id (upper-cased) → BusinessPartnerCategory
const BP_CATEGORY = { PERSON: '1', ORGANIZATION: '2', GROUP: '3' };

// Segments that only ever produce ONE row per Business Partner — every
// value mapped to one of these is merged into the same object regardless
// of which role/instance it was captured under.
const SINGLE_ROW_SEGMENTS = ['header', 'address', 'phone', 'mobile', 'fax', 'email'];

// Segments keyed by role + instance: one row per prerequisite-field
// combination (e.g. FLCU01 extended to company codes 1000 and 2000 → 2 rows).
const ROLE_INSTANCE_SEGMENTS = ['company', 'sales', 'purchasing'];

// Field → [segment, API property, value type].
//
// Looked up in this order (first hit wins):
//   1. "<source_table>.<source_field>"  — needed where the same ABAP field
//      name means something different per table (ZTERM, COUNTRY, WAERS …)
//   2. "<source_field>"
//   3. "<field_id>" / grid "<column_name>" — fallback for fields maintained
//      in Field Master without a source table/field
//
// Anything not listed here is NOT sent to S/4 — it is reported back as a
// warning on the posting result instead of failing the whole request, so
// add a line here whenever a new field is introduced in Field Master.
const FIELD_MAP = {
    // ── General data (BUT000) ────────────────────────────────────────────
    PARTNER          : ['header', 'BusinessPartner'],
    BU_PARTNER       : ['header', 'BusinessPartner'],
    NAME_ORG1        : ['header', 'OrganizationBPName1'],
    NAME_ORG2        : ['header', 'OrganizationBPName2'],
    NAME_ORG3        : ['header', 'OrganizationBPName3'],
    NAME_ORG4        : ['header', 'OrganizationBPName4'],
    NAME_GRP1        : ['header', 'GroupBusinessPartnerName1'],
    NAME_GRP2        : ['header', 'GroupBusinessPartnerName2'],
    NAME_FIRST       : ['header', 'FirstName'],
    VORNA            : ['header', 'FirstName'],
    NAME_LAST        : ['header', 'LastName'],
    NACHN            : ['header', 'LastName'],
    NAMEMIDDLE       : ['header', 'MiddleName'],
    MIDNM            : ['header', 'MiddleName'],
    BIRTHDT          : ['header', 'BirthDate', 'date'],
    GBDAT            : ['header', 'BirthDate', 'date'],
    // NAME1..NAME4 depend on the BP category — resolved in resolveTarget
    NAME1            : ['name', 1],
    NAME2            : ['name', 2],
    NAME3            : ['name', 3],
    NAME4            : ['name', 4],
    TITLE            : ['header', 'FormOfAddress'],
    TITLE_MEDI       : ['header', 'FormOfAddress'],
    BU_SORT1         : ['header', 'SearchTerm1'],
    BU_SORT1_TXT     : ['header', 'SearchTerm1'],
    BU_SORT2         : ['header', 'SearchTerm2'],
    BU_SORT2_TXT     : ['header', 'SearchTerm2'],
    LEGAL_ENTY       : ['header', 'LegalForm'],
    LEGAL_FORM       : ['header', 'LegalForm'],
    FOUND_DAT        : ['header', 'OrganizationFoundationDate', 'date'],
    LIQUID_DAT       : ['header', 'OrganizationLiquidationDate', 'date'],
    LOCATION_1       : ['header', 'InternationalLocationNumber1'],
    LOCATION_2       : ['header', 'InternationalLocationNumber2'],
    LOCATION_3       : ['header', 'InternationalLocationNumber3'],
    BPKIND           : ['header', 'BusinessPartnerType'],
    AUGRP            : ['header', 'AuthorizationGroup'],
    NATPERS          : ['header', 'IsNaturalPerson', 'flag'],
    BU_LANGU         : ['header', 'CorrespondenceLanguage'],

    // ── Standard address (ADDR1_DATA) ────────────────────────────────────
    STREET           : ['address', 'StreetName'],
    HOUSE_NUM1       : ['address', 'HouseNumber'],
    HOUSE_NUM2       : ['address', 'HouseNumberSupplementText'],
    STR_SUPPL1       : ['address', 'StreetPrefixName'],
    STR_SUPPL2       : ['address', 'AdditionalStreetPrefixName'],
    STR_SUPPL3       : ['address', 'StreetSuffixName'],
    LOCATION         : ['address', 'AdditionalStreetSuffixName'],
    CITY1            : ['address', 'CityName'],
    CITY             : ['address', 'CityName'],
    CITY2            : ['address', 'District'],
    HOME_CITY        : ['address', 'HomeCityName'],
    POST_CODE1       : ['address', 'PostalCode'],
    POST_CODE2       : ['address', 'POBoxPostalCode'],
    POST_CODE3       : ['address', 'CompanyPostalCode'],
    COUNTRY          : ['address', 'Country'],
    REGION           : ['address', 'Region'],
    LANGU            : ['address', 'Language'],
    NAME_CO          : ['address', 'CareOfName'],
    PO_BOX           : ['address', 'POBox'],
    PO_BOX_LOC       : ['address', 'POBoxDeviatingCityName'],
    PO_BOX_REG       : ['address', 'POBoxDeviatingRegion'],
    PO_BOX_CTY       : ['address', 'POBoxDeviatingCountry'],
    PO_BOX_LOBBY     : ['address', 'POBoxLobbyName'],
    PO_BOX_NUM       : ['address', 'POBoxIsWithoutNumber', 'flag'],
    DELI_SERV_TYPE   : ['address', 'DeliveryServiceTypeCode'],
    DELI_SERV_NUMBER : ['address', 'DeliveryServiceNumber'],
    TIME_ZONE        : ['address', 'AddressTimeZone'],
    TRANSPZONE       : ['address', 'TransportZone'],
    TAXJURCODE       : ['address', 'TaxJurisdiction'],

    // ── Communication (children of the address) ──────────────────────────
    TEL_NUMBER       : ['phone', 'PhoneNumber'],
    TELEPHONE        : ['phone', 'PhoneNumber'],
    TEL_EXTENS       : ['phone', 'PhoneNumberExtension'],
    TEL_COUNTR       : ['phone', 'DestinationLocationCountry'],
    MOB_NUMBER       : ['mobile', 'PhoneNumber'],
    MOB_COUNTR       : ['mobile', 'DestinationLocationCountry'],
    FAX_NUMBER       : ['fax', 'FaxNumber'],
    FAX_EXTENS       : ['fax', 'FaxNumberExtension'],
    FAX_COUNTR       : ['fax', 'FaxCountry'],
    SMTP_ADDR        : ['email', 'EmailAddress'],
    EMAIL            : ['email', 'EmailAddress'],

    // ── Tax numbers ──────────────────────────────────────────────────────
    TAXTYPE          : ['tax', 'BPTaxType'],
    TAXNUM           : ['tax', 'BPTaxNumber'],
    TAXNUMXL         : ['tax', 'BPTaxNumber'],
    // KNA1/LFA1-style tax fields carry no tax category of their own — the
    // category is derived from the address country (see kna1Tax below).
    STCEG            : ['kna1Tax', '0'],
    STCD1            : ['kna1Tax', '1'],
    STCD2            : ['kna1Tax', '2'],
    STCD3            : ['kna1Tax', '3'],
    STCD4            : ['kna1Tax', '4'],
    STCD5            : ['kna1Tax', '5'],

    // ── Identification numbers (BUT0ID) ──────────────────────────────────
    'VBUT0ID.TYPE'      : ['ident', 'BPIdentificationType'],
    'VBUT0ID.COUNTRY'   : ['ident', 'Country'],
    'VBUT0ID.REGION'    : ['ident', 'Region'],
    IDNUMBER            : ['ident', 'BPIdentificationNumber'],
    INSTITUTE           : ['ident', 'BPIdnNmbrIssuingInstitute'],
    BU_ENTRYDATESTR     : ['ident', 'BPIdentificationEntryDate', 'date'],
    BU_DATEFROMSTR_ID   : ['ident', 'ValidityStartDate', 'date'],
    BU_DATETOSTR_ID     : ['ident', 'ValidityEndDate', 'date'],

    // ── Industries (BUT0IS) ──────────────────────────────────────────────
    ISTYPE           : ['industry', 'IndustrySystemType'],
    ISEC             : ['industry', 'IndustrySector'],
    ISDEF            : ['industry', 'IsStandardIndustry', 'flag'],

    // ── Bank details (BUT0BK / KNBK / LFBK) ──────────────────────────────
    BANKS            : ['bank', 'BankCountryKey'],
    BANKL            : ['bank', 'BankNumber'],
    BANKN            : ['bank', 'BankAccount'],
    BKONT            : ['bank', 'BankControlKey'],
    KOINH            : ['bank', 'BankAccountHolderName'],
    IBAN             : ['bank', 'IBAN'],

    // ── Company code data (KNB1 / LFB1) — customer vs. supplier is decided
    //    by the role the value was captured under ─────────────────────────
    BUKRS            : ['company', 'CompanyCode'],
    AKONT            : ['company', 'ReconciliationAccount'],
    ZTERM            : ['company', 'PaymentTerms'],
    ZWELS            : ['company', 'PaymentMethodsList'],

    // ── Sales area data (KNVV) ───────────────────────────────────────────
    VKORG            : ['sales', 'SalesOrganization'],
    VTWEG            : ['sales', 'DistributionChannel'],
    SPART            : ['sales', 'Division'],
    'KNVV.WAERS'     : ['sales', 'Currency'],
    'KNVV.ZTERM'     : ['sales', 'CustomerPaymentTerms'],
    'KNVV.INCO1'     : ['sales', 'IncotermsClassification'],
    'KNVV.INCO2_L'   : ['sales', 'IncotermsLocation1'],
    BZIRK            : ['sales', 'SalesDistrict'],
    KONDA            : ['sales', 'CustomerPriceGroup'],
    KALKS            : ['sales', 'CustomerPricingProcedure'],
    VWERK            : ['sales', 'SupplyingPlant'],
    KTGRD            : ['sales', 'CustomerAccountAssignmentGroup'],
    KDGRP            : ['sales', 'CustomerGroup'],
    VSBED            : ['sales', 'ShippingCondition'],

    // ── Purchasing organization data (LFM1) ──────────────────────────────
    EKORG            : ['purchasing', 'PurchasingOrganization'],
    EKGRP            : ['purchasing', 'PurchasingGroup'],
    'LFM1.WAERS'     : ['purchasing', 'PurchaseOrderCurrency'],
    'LFM1.ZTERM'     : ['purchasing', 'PaymentTerms'],
    'LFM1.INCO1'     : ['purchasing', 'IncotermsClassification'],
    'LFM1.INCO2_L'   : ['purchasing', 'IncotermsLocation1']
};

// NAME1..NAME4 → category-specific header property
const NAME_BY_CATEGORY = {
    1: ['LastName', 'FirstName'],
    2: ['OrganizationBPName1', 'OrganizationBPName2', 'OrganizationBPName3', 'OrganizationBPName4'],
    3: ['GroupBusinessPartnerName1', 'GroupBusinessPartnerName2']
};

// The field in each role-instance segment that identifies the row — a row
// without it cannot be created in S/4, so it is dropped with a warning.
const SEGMENT_KEY = {
    company   : 'CompanyCode',
    sales     : 'SalesOrganization',
    purchasing: 'PurchasingOrganization'
};

function resolveTarget(oMeta, oFieldValue, sCategory) {
    const sTable = (oMeta && oMeta.source_table) || '';
    const sField = (oMeta && oMeta.source_field) || '';
    const sOwnName = oFieldValue.column_name || oFieldValue.field_field_id;

    const aTarget =
        (sTable && sField && FIELD_MAP[`${sTable}.${sField}`]) ||
        (sField && FIELD_MAP[sField]) ||
        FIELD_MAP[sOwnName];

    if (!aTarget) { return null; }

    if (aTarget[0] === 'name') {
        const sProp = (NAME_BY_CATEGORY[sCategory] || [])[aTarget[1] - 1];
        return sProp ? ['header', sProp] : null;
    }
    return aTarget;
}

// OData V2 expects Edm.DateTime as "/Date(<ms since epoch>)/". Accepts the
// YYYY-MM-DD the portal's date pickers produce, plus SAP-internal YYYYMMDD.
function toV2Date(sValue) {
    const aMatch = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(sValue);
    if (!aMatch) { return null; }
    const iMs = Date.UTC(Number(aMatch[1]), Number(aMatch[2]) - 1, Number(aMatch[3]));
    return Number.isNaN(iMs) ? null : `/Date(${iMs})/`;
}

function toFlag(sValue) {
    return ['X', 'TRUE', '1', 'YES', 'Y'].includes(String(sValue).toUpperCase());
}

// Customer or supplier side for one BP role. Standard FLCU*/FLVN* roles are
// recognised by name; anything else uses BPRole.account_scope, falling back
// to the CR's own account group type when the role is scoped BOTH.
function sideOfRole(sRoleId, mRoleMeta, oAccountGroup) {
    const sId = String(sRoleId || '').toUpperCase();
    if (sId.startsWith('FLCU')) { return 'customer'; }
    if (sId.startsWith('FLVN')) { return 'supplier'; }

    const sScope = mRoleMeta[sRoleId] && mRoleMeta[sRoleId].account_scope;
    if (sScope === 'VENDOR')   { return 'supplier'; }
    if (sScope === 'CUSTOMER') { return 'customer'; }
    return (oAccountGroup && oAccountGroup.type === 'VENDOR') ? 'supplier' : 'customer';
}

// Drops rows that are exact duplicates of an earlier one — the same general
// field (e.g. a bank account) can legitimately be captured under more than
// one role of the same CR.
function uniqueRows(aRows) {
    const oSeen = new Set();
    return aRows.filter((oRow) => {
        const sKey = JSON.stringify(oRow);
        if (oSeen.has(sKey)) { return false; }
        oSeen.add(sKey);
        return true;
    });
}

/**
 * Builds the A_BusinessPartner deep-insert payload for one CREATE request.
 *
 * @param {object}   oInput
 * @param {object}   oInput.cr            CRHeader row
 * @param {object[]} oInput.roles         CRBPRole rows of the CR
 * @param {object[]} oInput.fieldValues   CRFieldValue rows of the CR
 * @param {object}   oInput.fieldMeta     FieldMaster rows keyed by field_id
 * @param {object}   oInput.gridMeta      GridColumn rows keyed by "<field_id>::<column_name>"
 * @param {object}   oInput.roleMeta      BPRole rows keyed by role_id
 * @param {object}   [oInput.accountGroup] AccountGroup row of the CR
 * @param {string}   [oInput.mode]        'create' (default) or 'update' — in
 *                   update mode the result describes the desired state of
 *                   an EXISTING BP: no category/grouping/BP number in the
 *                   header and no generated bank IDs (updateBusinessPartner
 *                   compares it with what S/4 already has)
 * @param {string}   [oInput.categoryCode] S/4 BusinessPartnerCategory to use
 *                   instead of deriving it from the CR (update mode passes
 *                   the existing BP's own category)
 * @returns {{payload: object, warnings: string[]}}
 */
function buildBusinessPartnerPayload(oInput) {
    const cr            = oInput.cr;
    const aRoles        = oInput.roles || [];
    const aFieldValues  = oInput.fieldValues || [];
    const mFieldMeta    = oInput.fieldMeta || {};
    const mGridMeta     = oInput.gridMeta || {};
    const mRoleMeta     = oInput.roleMeta || {};
    const oAccountGroup = oInput.accountGroup || null;
    const bUpdate       = oInput.mode === 'update';

    const aWarnings = [];

    const sCategory = oInput.categoryCode || BP_CATEGORY[String(cr.bp_category_category_id || '').toUpperCase()];
    if (!sCategory) {
        throw new Error(
            `BP category "${cr.bp_category_category_id || ''}" cannot be mapped to an S/4HANA ` +
            'Business Partner category (expected Person, Organization or Group).'
        );
    }
    if (!bUpdate && !cr.account_group_account_group_id) {
        throw new Error('The change request has no BP Account Group — it is needed as the Business Partner grouping.');
    }

    // ── 1. Sort every captured value into its target segment row ─────────
    const mBuckets  = {};
    const aKna1Tax  = [];
    const aUnmapped = [];

    aFieldValues.forEach((oFv) => {
        const sValue = oFv.new_value === null || oFv.new_value === undefined
            ? '' : String(oFv.new_value).trim();
        if (!sValue) { return; }

        const sFieldId = oFv.field_field_id;
        const oMeta = oFv.column_name
            ? mGridMeta[`${sFieldId}::${oFv.column_name}`]
            : mFieldMeta[sFieldId];
        const aTarget = resolveTarget(oMeta, oFv, sCategory);
        const sLabel = oFv.column_name ? `${sFieldId}/${oFv.column_name}` : sFieldId;

        if (!aTarget) {
            aUnmapped.push(sLabel);
            return;
        }

        const sSegment = aTarget[0];
        if (sSegment === 'kna1Tax') {
            aKna1Tax.push({ suffix: aTarget[1], value: sValue, label: sLabel });
            return;
        }

        let vValue = sValue;
        if (aTarget[2] === 'date') {
            vValue = toV2Date(sValue);
            if (!vValue) {
                aWarnings.push(`Field ${sLabel}: "${sValue}" is not a valid date and was not sent.`);
                return;
            }
        } else if (aTarget[2] === 'flag') {
            vValue = toFlag(sValue);
        }

        const sRoleId = oFv.role_id || '';
        const iInstance = oFv.instance_no || 1;
        let sBucketKey;
        if (SINGLE_ROW_SEGMENTS.includes(sSegment)) {
            sBucketKey = sSegment;
        } else if (ROLE_INSTANCE_SEGMENTS.includes(sSegment)) {
            sBucketKey = `${sSegment}|${sRoleId}|${iInstance}`;
        } else {
            // Multi-row general segments (tax, ident, industry, bank): one
            // row per grid row, or one per role instance for plain fields.
            sBucketKey = `${sSegment}|${sRoleId}|${iInstance}|${oFv.column_name ? sFieldId : ''}|${oFv.counter || 0}`;
        }

        if (!mBuckets[sBucketKey]) {
            mBuckets[sBucketKey] = { segment: sSegment, role_id: sRoleId, instance_no: iInstance, props: {}, labels: [] };
        }
        mBuckets[sBucketKey].props[aTarget[1]] = vValue;
        mBuckets[sBucketKey].labels.push(sLabel);
    });

    const aBuckets = Object.keys(mBuckets).map((sKey) => mBuckets[sKey]);
    const propsOf = (sSegment) => (mBuckets[sSegment] ? mBuckets[sSegment].props : {});
    const rowsOf  = (sSegment) => aBuckets.filter((oBucket) => oBucket.segment === sSegment);

    // ── 2. Header ────────────────────────────────────────────────────────
    const oHeader = Object.assign({}, propsOf('header'));
    // The BP number is only sent for externally numbered account groups;
    // for internal ones S/4 draws it from the number range and returns it.
    if (bUpdate || (oAccountGroup && oAccountGroup.assignment_mode === 'INTERNAL')) {
        delete oHeader.BusinessPartner;
    }

    // Category and grouping are fixed once a BP exists in S/4 — only sent
    // on create.
    const oPayload = bUpdate ? oHeader : Object.assign({
        BusinessPartnerCategory: sCategory,
        BusinessPartnerGrouping: cr.account_group_account_group_id
    }, oHeader);

    // ── 3. Roles ─────────────────────────────────────────────────────────
    const aRoleIds = Array.from(new Set(aRoles.map((oRole) => oRole.role_role_id).filter(Boolean)));
    if (aRoleIds.length) {
        oPayload.to_BusinessPartnerRole = aRoleIds.map((sRoleId) => ({ BusinessPartnerRole: sRoleId }));
    }

    // ── 4. Address + communication ───────────────────────────────────────
    const oAddress = Object.assign({}, propsOf('address'));
    const mCommunication = {
        to_PhoneNumber      : propsOf('phone'),
        to_MobilePhoneNumber: propsOf('mobile'),
        to_FaxNumber        : propsOf('fax'),
        to_EmailAddress     : propsOf('email')
    };
    Object.keys(mCommunication).forEach((sNav) => {
        if (Object.keys(mCommunication[sNav]).length) {
            oAddress[sNav] = [mCommunication[sNav]];
        }
    });
    if (Object.keys(oAddress).length) {
        oPayload.to_BusinessPartnerAddress = [oAddress];
    }
    const sCountry = oAddress.Country || '';

    // ── 5. Tax numbers ───────────────────────────────────────────────────
    const aTax = [];
    rowsOf('tax').forEach((oBucket) => {
        const oRow = Object.assign({}, oBucket.props);
        if (!oRow.BPTaxType || !oRow.BPTaxNumber) {
            aWarnings.push(`Tax number (${oBucket.labels.join(', ')}) needs both a tax category and a number — not sent.`);
            return;
        }
        aTax.push(oRow);
    });
    aKna1Tax.forEach((oTax) => {
        if (!sCountry) {
            aWarnings.push(`Field ${oTax.label}: tax category cannot be derived without an address country — not sent.`);
            return;
        }
        // Standard S/4 tax categories: <country>0 = VAT registration no.,
        // <country>1..5 = tax number 1..5.
        aTax.push({ BPTaxType: `${sCountry}${oTax.suffix}`, BPTaxNumber: oTax.value });
    });
    aTax.forEach((oRow) => {
        // BPTaxNumber holds 20 characters; longer numbers go to the long field.
        if (oRow.BPTaxNumber.length > 20) {
            oRow.BPTaxLongNumber = oRow.BPTaxNumber;
            delete oRow.BPTaxNumber;
        }
    });
    if (aTax.length) { oPayload.to_BusinessPartnerTax = uniqueRows(aTax); }

    // ── 6. Identification numbers ────────────────────────────────────────
    const aIdent = [];
    rowsOf('ident').forEach((oBucket) => {
        if (!oBucket.props.BPIdentificationType || !oBucket.props.BPIdentificationNumber) {
            aWarnings.push(`Identification (${oBucket.labels.join(', ')}) needs both an ID type and a number — not sent.`);
            return;
        }
        aIdent.push(Object.assign({}, oBucket.props));
    });
    if (aIdent.length) { oPayload.to_BuPaIdentification = uniqueRows(aIdent); }

    // ── 7. Industries ────────────────────────────────────────────────────
    const aIndustry = [];
    rowsOf('industry').forEach((oBucket) => {
        if (!oBucket.props.IndustrySystemType || !oBucket.props.IndustrySector) {
            aWarnings.push(`Industry (${oBucket.labels.join(', ')}) needs both an industry system and a sector — not sent.`);
            return;
        }
        aIndustry.push(Object.assign({}, oBucket.props));
    });
    if (aIndustry.length) { oPayload.to_BuPaIndustry = uniqueRows(aIndustry); }

    // ── 8. Bank details ──────────────────────────────────────────────────
    const aBank = [];
    rowsOf('bank').forEach((oBucket) => {
        const oRow = Object.assign({}, oBucket.props);
        if (!oRow.BankCountryKey && sCountry) { oRow.BankCountryKey = sCountry; }
        if (!oRow.BankCountryKey || !(oRow.BankNumber || oRow.IBAN)) {
            aWarnings.push(`Bank details (${oBucket.labels.join(', ')}) need a bank country and a bank key or IBAN — not sent.`);
            return;
        }
        aBank.push(oRow);
    });
    if (aBank.length) {
        // On update the next free BankIdentification depends on the banks
        // the BP already has — assigned by updateBusinessPartner instead.
        oPayload.to_BusinessPartnerBank = bUpdate ? uniqueRows(aBank) : uniqueRows(aBank).map((oRow, iIndex) =>
            Object.assign({ BankIdentification: String(iIndex + 1).padStart(4, '0') }, oRow)
        );
    }

    // ── 9. Customer / supplier company, sales and purchasing data ────────
    const mSide = { customer: { company: [], sales: [] }, supplier: { company: [], purchasing: [] } };
    ROLE_INSTANCE_SEGMENTS.forEach((sSegment) => {
        rowsOf(sSegment).forEach((oBucket) => {
            const sWhere = `role ${oBucket.role_id || '(none)'} instance ${oBucket.instance_no}`;
            if (!oBucket.props[SEGMENT_KEY[sSegment]]) {
                aWarnings.push(
                    `${oBucket.labels.join(', ')} (${sWhere}) not sent — no ${SEGMENT_KEY[sSegment]} captured for this ${sSegment} data.`
                );
                return;
            }
            const sSide = sideOfRole(oBucket.role_id, mRoleMeta, oAccountGroup);
            if (!mSide[sSide][sSegment]) {
                aWarnings.push(`${oBucket.labels.join(', ')} (${sWhere}) not sent — ${sSegment} data does not apply to a ${sSide} role.`);
                return;
            }
            mSide[sSide][sSegment].push(Object.assign({}, oBucket.props));
        });
    });

    const oCustomer = {};
    if (mSide.customer.company.length) { oCustomer.to_CustomerCompany = mSide.customer.company; }
    if (mSide.customer.sales.length)   { oCustomer.to_CustomerSalesArea = mSide.customer.sales; }
    if (Object.keys(oCustomer).length) { oPayload.to_Customer = oCustomer; }

    const oSupplier = {};
    if (mSide.supplier.company.length)    { oSupplier.to_SupplierCompany = mSide.supplier.company; }
    if (mSide.supplier.purchasing.length) { oSupplier.to_SupplierPurchasingOrg = mSide.supplier.purchasing; }
    if (Object.keys(oSupplier).length)    { oPayload.to_Supplier = oSupplier; }

    if (aUnmapped.length) {
        aWarnings.push(
            `No S/4HANA mapping for field(s) ${Array.from(new Set(aUnmapped)).join(', ')} — not sent.`
        );
    }

    return { payload: oPayload, warnings: aWarnings };
}

// Pulls a readable message out of a failed S/4 call. SAP Gateway puts the
// useful text in error.message.value plus innererror.errordetails; CAP's
// remote-service wrapper nests the original response under err.reason.
function extractS4Error(err) {
    const oBody =
        (err && err.reason && err.reason.response && err.reason.response.body) ||
        (err && err.response && (err.response.data || err.response.body)) ||
        null;
    const oError = oBody && oBody.error;

    if (!oError) {
        return (err && err.message) || String(err);
    }

    const sMain = (oError.message && (oError.message.value || oError.message)) || err.message || 'Unknown S/4HANA error';
    const aDetails = ((oError.innererror && oError.innererror.errordetails) || [])
        .filter((oDetail) => oDetail && oDetail.message && oDetail.severity !== 'info' && oDetail.message !== sMain)
        .map((oDetail) => oDetail.message);

    const aAll = Array.from(new Set([String(sMain)].concat(aDetails)));
    return aAll.slice(0, 10).join(' | ');
}

// =============================================================================
//  S/4HANA CALLS
// =============================================================================

// Reads everything the payload builder needs for one CR from the portal DB.
async function loadCrData(cr) {
    const sCrId = cr.cr_id;

    const aRoles = await SELECT.from('mdm.portal.CRBPRole').where({ cr_cr_id: sCrId });
    const aFieldValues = await SELECT.from('mdm.portal.CRFieldValue').where({ cr_cr_id: sCrId });

    const aFieldIds = Array.from(new Set(aFieldValues.map((fv) => fv.field_field_id)));
    const aFieldMaster = aFieldIds.length
        ? await SELECT.from('mdm.portal.FieldMaster').where({ field_id: { in: aFieldIds } })
        : [];
    const aGridColumns = aFieldIds.length
        ? await SELECT.from('mdm.portal.GridColumn').where({ field_field_id: { in: aFieldIds } })
        : [];

    const aRoleIds = Array.from(new Set(
        aRoles.map((r) => r.role_role_id).concat(aFieldValues.map((fv) => fv.role_id)).filter(Boolean)
    ));
    const aRoleMeta = aRoleIds.length
        ? await SELECT.from('mdm.portal.BPRole').where({ role_id: { in: aRoleIds } })
        : [];

    const oAccountGroup = cr.account_group_account_group_id
        ? await SELECT.one.from('mdm.portal.AccountGroup')
            .where({ account_group_id: cr.account_group_account_group_id })
        : null;

    const mFieldMeta = {};
    aFieldMaster.forEach((f) => { mFieldMeta[f.field_id] = f; });
    const mGridMeta = {};
    aGridColumns.forEach((g) => { mGridMeta[`${g.field_field_id}::${g.column_name}`] = g; });
    const mRoleMeta = {};
    aRoleMeta.forEach((r) => { mRoleMeta[r.role_id] = r; });

    return {
        cr,
        roles: aRoles,
        fieldValues: aFieldValues,
        fieldMeta: mFieldMeta,
        gridMeta: mGridMeta,
        roleMeta: mRoleMeta,
        accountGroup: oAccountGroup
    };
}

// Connected on demand rather than at startup so the app still starts (and
// everything except posting still works) while the S/4 destination isn't
// reachable. cds.connect.to caches the connection.
function connectS4() {
    return cds.connect.to(S4_BP_SERVICE);
}

// OData V2 key predicate, e.g. A_CustomerCompany(Customer='17100001',CompanyCode='1710')
function keyPath(sEntitySet, mKeys) {
    const sKeys = Object.keys(mKeys)
        .map((sKey) => `${sKey}='${encodeURIComponent(String(mKeys[sKey]).replace(/'/g, "''"))}'`)
        .join(',');
    return `/${sEntitySet}(${sKeys})`;
}

// Path of an entity S/4 returned to us — taken from its own OData V2
// metadata URI when CAP kept it (exposed as $metadata), so the key
// predicate is exactly what S/4 expects; built from the keys otherwise.
function entityPath(oEntity, sFallback) {
    const sUri = oEntity && oEntity.$metadata && oEntity.$metadata.uri;
    const sMarker = '/API_BUSINESS_PARTNER/';
    const iAt = sUri ? sUri.indexOf(sMarker) : -1;
    return iAt >= 0 ? `/${sUri.slice(iAt + sMarker.length)}` : sFallback;
}

// Optimistic-locking header for updates — only sent when S/4 gave us an ETag.
function ifMatch(oEntity) {
    const sEtag = oEntity && oEntity.$metadata && oEntity.$metadata.etag;
    return sEtag ? { 'If-Match': sEtag } : {};
}

// Expanded V2 collections arrive as arrays (CAP unwraps { results: [...] }).
function asArray(vValue) {
    if (Array.isArray(vValue)) { return vValue; }
    return (vValue && Array.isArray(vValue.results)) ? vValue.results : [];
}

// Scalar properties only — drops to_* navigation properties.
function scalarProps(oRow) {
    const oResult = {};
    Object.keys(oRow || {}).forEach((sKey) => {
        if (!sKey.startsWith('to_')) { oResult[sKey] = oRow[sKey]; }
    });
    return oResult;
}

// The subset of oDesired that differs from what S/4 already has.
function changedProps(oDesired, oExisting) {
    const oResult = {};
    Object.keys(scalarProps(oDesired)).forEach((sKey) => {
        const vNew = oDesired[sKey];
        const vOld = oExisting ? oExisting[sKey] : undefined;
        if (String(vNew) !== String(vOld === null || vOld === undefined ? '' : vOld)) {
            oResult[sKey] = vNew;
        }
    });
    return oResult;
}

function isNotFound(err) {
    const iStatus =
        (err && err.reason && err.reason.response && err.reason.response.status) ||
        (err && err.reason && err.reason.status) ||
        (err && err.response && err.response.status) ||
        (err && err.status);
    return iStatus === 404;
}

const BP_EXPAND_FULL = [
    'to_BusinessPartnerRole',
    'to_BusinessPartnerAddress/to_PhoneNumber',
    'to_BusinessPartnerAddress/to_MobilePhoneNumber',
    'to_BusinessPartnerAddress/to_FaxNumber',
    'to_BusinessPartnerAddress/to_EmailAddress',
    'to_BusinessPartnerTax',
    'to_BusinessPartnerBank',
    'to_BuPaIdentification',
    'to_BuPaIndustry',
    'to_Customer/to_CustomerCompany',
    'to_Customer/to_CustomerSalesArea',
    'to_Supplier/to_SupplierCompany',
    'to_Supplier/to_SupplierPurchasingOrg'
].join(',');

const BP_EXPAND_CUSTOMER_SUPPLIER = [
    'to_Customer/to_CustomerCompany',
    'to_Customer/to_CustomerSalesArea',
    'to_Supplier/to_SupplierCompany',
    'to_Supplier/to_SupplierPurchasingOrg'
].join(',');

/**
 * Reads one Business Partner from S/4HANA, including the child data named
 * in sExpand (comma-separated $expand list).
 *
 * @returns {Promise<object>} the A_BusinessPartner entity
 */
async function readBusinessPartner(sBpNumber, sExpand) {
    const s4 = await connectS4();
    const sPath = keyPath('A_BusinessPartner', { BusinessPartner: sBpNumber }) +
        (sExpand ? `?$expand=${sExpand}` : '');
    try {
        return await s4.send({ method: 'GET', path: sPath });
    } catch (err) {
        if (isNotFound(err)) {
            throw new Error(`Business Partner ${sBpNumber} was not found in S/4HANA.`);
        }
        throw err;
    }
}

// Runs a sequence of S/4 write calls one by one, remembering what already
// succeeded so a failure part-way through says exactly how far it got.
// API_BUSINESS_PARTNER has no multi-entity transaction outside $batch, so
// an update is NOT atomic — but every step is an upsert against freshly
// read S/4 data, so simply re-posting the CR after fixing the cause picks
// up where the failed attempt stopped.
function createStepRunner(s4) {
    const aDone = [];
    const run = async (sStep, oRequest) => {
        try {
            await s4.send(oRequest);
            aDone.push(sStep);
        } catch (err) {
            throw new Error(
                `${sStep} failed: ${extractS4Error(err)}` +
                (aDone.length ? ` — already done in S/4HANA: ${aDone.join('; ')}` : '')
            );
        }
    };
    return {
        done: aDone,
        patch: (sStep, oEntity, sFallbackPath, oData) =>
            run(sStep, { method: 'PATCH', path: entityPath(oEntity, sFallbackPath), data: oData, headers: ifMatch(oEntity) }),
        post: (sStep, sPath, oData) =>
            run(sStep, { method: 'POST', path: sPath, data: oData })
    };
}

// PATCHes oHave with whatever in oWant differs from it — no call at all
// when nothing differs.
async function patchChanges(oRunner, sStep, oWant, oHave, sFallbackPath) {
    const oChanges = changedProps(oWant, oHave);
    if (Object.keys(oChanges).length) {
        await oRunner.patch(sStep, oHave, sFallbackPath, oChanges);
    }
}

/**
 * Creates the Business Partner in S/4HANA for one CREATE change request
 * and returns the number S/4 assigned to it.
 *
 * One deep insert on A_BusinessPartner carries the roles, address, tax/ID
 * numbers, bank details and customer/supplier data, so S/4 either creates
 * the whole BP or nothing.
 *
 * Throws on any failure (mapping problem, destination not reachable, S/4
 * validation error) — the caller (_postApprovedCr in mdm-service.js) turns
 * that into a POSTING_FAILED status.
 *
 * @param {object} cr  CRHeader row
 * @returns {Promise<{bpNumber: string, warnings: string[], changes: string[]}>}
 */
async function createBusinessPartner(cr) {
    const { payload, warnings } = buildBusinessPartnerPayload(await loadCrData(cr));

    if (warnings.length) {
        console.warn(`[s4] CR ${cr.cr_id} — values not sent to S/4HANA:`, warnings);
    }

    const s4 = await connectS4();
    const oResponse = await s4.send({
        method: 'POST',
        path: '/A_BusinessPartner',
        data: payload
    });

    // OData V2 wraps a created entity in { d: {...} } — unwrapped already
    // by CAP for odata-v2 services, handled here too in case the raw body
    // comes through.
    const oCreated = (oResponse && oResponse.d) || oResponse || {};
    if (!oCreated.BusinessPartner) {
        throw new Error('S/4HANA accepted the request but returned no Business Partner number.');
    }

    console.log(`[s4] CR ${cr.cr_id} — Business Partner ${oCreated.BusinessPartner} created in S/4HANA`);
    return { bpNumber: oCreated.BusinessPartner, warnings, changes: ['Business Partner created'] };
}

/**
 * Applies a CHANGE or EXTEND change request to an EXISTING Business
 * Partner in S/4HANA (the BP number is the CR's reference_object_no).
 *
 * Reads the BP's current data first and then, per segment, updates what
 * differs and creates what is missing:
 *   general data             PATCH A_BusinessPartner
 *   roles                    POST  …/to_BusinessPartnerRole (new roles only)
 *   address + phone/e-mail   PATCH the existing standard address, or POST one
 *   tax / ID / industry /    PATCH the matching row, POST otherwise
 *   bank
 *   customer company code /  PATCH the matching row, POST otherwise
 *   sales area               (= extending the customer)
 *   supplier company code /  same, on the supplier side
 *   purchasing org
 * Values the CR doesn't carry are left untouched in S/4 — nothing is ever
 * cleared or removed by an update.
 *
 * @param {object} cr  CRHeader row
 * @returns {Promise<{bpNumber: string, warnings: string[], changes: string[]}>}
 */
async function updateBusinessPartner(cr) {
    const sBp = cr.reference_object_no;
    if (!sBp) {
        throw new Error(`CR ${cr.cr_id} has no Business Partner number (reference_object_no) to update.`);
    }

    const s4 = await connectS4();
    let oBp = await readBusinessPartner(sBp, BP_EXPAND_FULL);

    const { payload, warnings } = buildBusinessPartnerPayload(Object.assign(await loadCrData(cr), {
        mode: 'update',
        categoryCode: oBp.BusinessPartnerCategory
    }));

    const oRunner = createStepRunner(s4);
    const sBpPath = keyPath('A_BusinessPartner', { BusinessPartner: sBp });
    const withBp = (oRow) => Object.assign({ BusinessPartner: sBp }, oRow);

    // ── General data ─────────────────────────────────────────────────────
    await patchChanges(oRunner, 'Update general data', payload, oBp, sBpPath);

    // ── Roles — first, because adding FLCU01/FLVN01 is what creates the
    //    customer/supplier that company, sales and purchasing data need ──
    const oHasRole = new Set(asArray(oBp.to_BusinessPartnerRole).map((r) => r.BusinessPartnerRole));
    let bRoleAdded = false;
    for (const oRole of (payload.to_BusinessPartnerRole || [])) {
        if (!oHasRole.has(oRole.BusinessPartnerRole)) {
            await oRunner.post(`Add role ${oRole.BusinessPartnerRole}`, `${sBpPath}/to_BusinessPartnerRole`, withBp(oRole));
            bRoleAdded = true;
        }
    }

    // ── Address + communication ──────────────────────────────────────────
    const oWantAddress = (payload.to_BusinessPartnerAddress || [])[0];
    if (oWantAddress) {
        const oAddress = asArray(oBp.to_BusinessPartnerAddress)[0];
        if (!oAddress) {
            await oRunner.post('Add address', `${sBpPath}/to_BusinessPartnerAddress`, withBp(oWantAddress));
        } else {
            const sAddressPath = keyPath('A_BusinessPartnerAddress', { BusinessPartner: sBp, AddressID: oAddress.AddressID });
            await patchChanges(oRunner, 'Update address', oWantAddress, oAddress, sAddressPath);

            const mComm = {
                to_PhoneNumber      : ['A_AddressPhoneNumber', 'phone number'],
                to_MobilePhoneNumber: ['A_AddressPhoneNumber', 'mobile number'],
                to_FaxNumber        : ['A_AddressFaxNumber', 'fax number'],
                to_EmailAddress     : ['A_AddressEmailAddress', 'e-mail address']
            };
            for (const sNav of Object.keys(mComm)) {
                const oWant = (oWantAddress[sNav] || [])[0];
                if (!oWant) { continue; }
                const oHave = asArray(oAddress[sNav])[0];
                const [sSet, sLabel] = mComm[sNav];
                if (!oHave) {
                    await oRunner.post(`Add ${sLabel}`, `${sAddressPath}/${sNav}`, oWant);
                } else {
                    await patchChanges(oRunner, `Update ${sLabel}`, oWant, oHave,
                        keyPath(sSet, { AddressID: oHave.AddressID, Person: oHave.Person || '', OrdinalNumber: oHave.OrdinalNumber }));
                }
            }
        }
    }

    // ── Tax numbers — one per tax category ───────────────────────────────
    for (const oWant of (payload.to_BusinessPartnerTax || [])) {
        const oHave = asArray(oBp.to_BusinessPartnerTax).find((t) => t.BPTaxType === oWant.BPTaxType);
        if (!oHave) {
            await oRunner.post(`Add tax number ${oWant.BPTaxType}`, `${sBpPath}/to_BusinessPartnerTax`, withBp(oWant));
        } else {
            await patchChanges(oRunner, `Update tax number ${oWant.BPTaxType}`, oWant, oHave,
                keyPath('A_BusinessPartnerTaxNumber', { BusinessPartner: sBp, BPTaxType: oWant.BPTaxType }));
        }
    }

    // ── Identification numbers — matched on type + number ───────────────
    for (const oWant of (payload.to_BuPaIdentification || [])) {
        const oHave = asArray(oBp.to_BuPaIdentification).find((i) =>
            i.BPIdentificationType === oWant.BPIdentificationType &&
            i.BPIdentificationNumber === oWant.BPIdentificationNumber);
        const sLabel = `identification ${oWant.BPIdentificationType} ${oWant.BPIdentificationNumber}`;
        if (!oHave) {
            await oRunner.post(`Add ${sLabel}`, `${sBpPath}/to_BuPaIdentification`, withBp(oWant));
        } else {
            await patchChanges(oRunner, `Update ${sLabel}`, oWant, oHave,
                keyPath('A_BuPaIdentification', {
                    BusinessPartner: sBp,
                    BPIdentificationType: oWant.BPIdentificationType,
                    BPIdentificationNumber: oWant.BPIdentificationNumber
                }));
        }
    }

    // ── Industries — matched on system type + sector ─────────────────────
    for (const oWant of (payload.to_BuPaIndustry || [])) {
        const oHave = asArray(oBp.to_BuPaIndustry).find((i) =>
            i.IndustrySystemType === oWant.IndustrySystemType && i.IndustrySector === oWant.IndustrySector);
        const sLabel = `industry ${oWant.IndustrySystemType}/${oWant.IndustrySector}`;
        if (!oHave) {
            await oRunner.post(`Add ${sLabel}`, `${sBpPath}/to_BuPaIndustry`, withBp(oWant));
        } else {
            await patchChanges(oRunner, `Update ${sLabel}`, oWant, oHave,
                keyPath('A_BuPaIndustry', {
                    IndustrySector: oWant.IndustrySector,
                    IndustrySystemType: oWant.IndustrySystemType,
                    BusinessPartner: sBp
                }));
        }
    }

    // ── Bank details — matched on IBAN, or bank country + key + account ──
    const aHaveBanks = asArray(oBp.to_BusinessPartnerBank);
    let iNextBankId = aHaveBanks.reduce((iMax, b) => Math.max(iMax, parseInt(b.BankIdentification, 10) || 0), 0) + 1;
    for (const oWant of (payload.to_BusinessPartnerBank || [])) {
        const oHave = aHaveBanks.find((b) =>
            (oWant.IBAN && b.IBAN === oWant.IBAN) ||
            (b.BankCountryKey === oWant.BankCountryKey && b.BankNumber === oWant.BankNumber &&
                String(b.BankAccount || '') === String(oWant.BankAccount || '')));
        if (!oHave) {
            const sBankId = String(iNextBankId++).padStart(4, '0');
            await oRunner.post(`Add bank ${oWant.BankNumber || oWant.IBAN}`, `${sBpPath}/to_BusinessPartnerBank`,
                withBp(Object.assign({ BankIdentification: sBankId }, oWant)));
        } else {
            await patchChanges(oRunner, `Update bank ${oHave.BankIdentification}`, oWant, oHave,
                keyPath('A_BusinessPartnerBank', { BusinessPartner: sBp, BankIdentification: oHave.BankIdentification }));
        }
    }

    // ── Customer / supplier data ─────────────────────────────────────────
    // A role added above has just created the customer/supplier in S/4 —
    // re-read so its number is known.
    if (bRoleAdded && ((payload.to_Customer && !oBp.to_Customer) || (payload.to_Supplier && !oBp.to_Supplier))) {
        const oFresh = await readBusinessPartner(sBp, BP_EXPAND_CUSTOMER_SUPPLIER);
        oBp = Object.assign({}, oBp, { to_Customer: oFresh.to_Customer, to_Supplier: oFresh.to_Supplier });
    }

    const sDoneSoFar = () => (oRunner.done.length ? ` Already done in S/4HANA: ${oRunner.done.join('; ')}` : '');

    if (payload.to_Customer) {
        const oCustomer = oBp.to_Customer;
        if (!oCustomer || !oCustomer.Customer) {
            throw new Error(
                `Business Partner ${sBp} has no customer in S/4HANA — the request needs a customer role ` +
                `(e.g. FLCU01) to add company code or sales area data.${sDoneSoFar()}`
            );
        }
        const sCustomer = oCustomer.Customer;
        const sCustomerPath = keyPath('A_Customer', { Customer: sCustomer });

        for (const oWant of (payload.to_Customer.to_CustomerCompany || [])) {
            const oHave = asArray(oCustomer.to_CustomerCompany).find((c) => c.CompanyCode === oWant.CompanyCode);
            if (!oHave) {
                await oRunner.post(`Extend customer to company code ${oWant.CompanyCode}`,
                    `${sCustomerPath}/to_CustomerCompany`, Object.assign({ Customer: sCustomer }, oWant));
            } else {
                await patchChanges(oRunner, `Update customer company code ${oWant.CompanyCode}`, oWant, oHave,
                    keyPath('A_CustomerCompany', { Customer: sCustomer, CompanyCode: oWant.CompanyCode }));
            }
        }

        for (const oWant of (payload.to_Customer.to_CustomerSalesArea || [])) {
            const oHave = asArray(oCustomer.to_CustomerSalesArea).find((s) =>
                s.SalesOrganization === oWant.SalesOrganization &&
                s.DistributionChannel === oWant.DistributionChannel &&
                s.Division === oWant.Division);
            const sArea = `${oWant.SalesOrganization}/${oWant.DistributionChannel}/${oWant.Division}`;
            if (!oHave) {
                await oRunner.post(`Extend customer to sales area ${sArea}`,
                    `${sCustomerPath}/to_CustomerSalesArea`, Object.assign({ Customer: sCustomer }, oWant));
            } else {
                await patchChanges(oRunner, `Update customer sales area ${sArea}`, oWant, oHave,
                    keyPath('A_CustomerSalesArea', {
                        Customer: sCustomer,
                        SalesOrganization: oWant.SalesOrganization,
                        DistributionChannel: oWant.DistributionChannel,
                        Division: oWant.Division
                    }));
            }
        }
    }

    if (payload.to_Supplier) {
        const oSupplier = oBp.to_Supplier;
        if (!oSupplier || !oSupplier.Supplier) {
            throw new Error(
                `Business Partner ${sBp} has no supplier in S/4HANA — the request needs a supplier role ` +
                `(e.g. FLVN01) to add company code or purchasing data.${sDoneSoFar()}`
            );
        }
        const sSupplier = oSupplier.Supplier;
        const sSupplierPath = keyPath('A_Supplier', { Supplier: sSupplier });

        for (const oWant of (payload.to_Supplier.to_SupplierCompany || [])) {
            const oHave = asArray(oSupplier.to_SupplierCompany).find((c) => c.CompanyCode === oWant.CompanyCode);
            if (!oHave) {
                await oRunner.post(`Extend supplier to company code ${oWant.CompanyCode}`,
                    `${sSupplierPath}/to_SupplierCompany`, Object.assign({ Supplier: sSupplier }, oWant));
            } else {
                await patchChanges(oRunner, `Update supplier company code ${oWant.CompanyCode}`, oWant, oHave,
                    keyPath('A_SupplierCompany', { Supplier: sSupplier, CompanyCode: oWant.CompanyCode }));
            }
        }

        for (const oWant of (payload.to_Supplier.to_SupplierPurchasingOrg || [])) {
            const oHave = asArray(oSupplier.to_SupplierPurchasingOrg).find((p) =>
                p.PurchasingOrganization === oWant.PurchasingOrganization);
            if (!oHave) {
                await oRunner.post(`Extend supplier to purchasing org ${oWant.PurchasingOrganization}`,
                    `${sSupplierPath}/to_SupplierPurchasingOrg`, Object.assign({ Supplier: sSupplier }, oWant));
            } else {
                await patchChanges(oRunner, `Update supplier purchasing org ${oWant.PurchasingOrganization}`, oWant, oHave,
                    keyPath('A_SupplierPurchasingOrg', { Supplier: sSupplier, PurchasingOrganization: oWant.PurchasingOrganization }));
            }
        }
    }

    if (!oRunner.done.length) {
        warnings.push(`Business Partner ${sBp} already had every value in the request — nothing was changed in S/4HANA.`);
    }
    if (warnings.length) {
        console.warn(`[s4] CR ${cr.cr_id} — update warnings:`, warnings);
    }

    console.log(`[s4] CR ${cr.cr_id} — Business Partner ${sBp} updated in S/4HANA:`, oRunner.done);
    return { bpNumber: sBp, warnings, changes: oRunner.done };
}

/**
 * "Deletes" the Business Partner of a DELETE change request.
 *
 * API_BUSINESS_PARTNER cannot physically delete a Business Partner — in
 * S/4 that only happens through archiving (SARA, archiving object
 * CA_BUPA), which picks up BPs that carry the archiving flag. So this sets
 * exactly what the deletion flag in transaction BP sets:
 *   A_BusinessPartner.IsMarkedForArchiving = true
 *   A_Customer.DeletionIndicator           = true  (if the BP is a customer)
 *   A_Supplier.DeletionIndicator           = true  (if the BP is a supplier)
 *
 * @param {object} cr  CRHeader row
 * @returns {Promise<{bpNumber: string, warnings: string[], changes: string[]}>}
 */
async function markBusinessPartnerForDeletion(cr) {
    const sBp = cr.reference_object_no;
    if (!sBp) {
        throw new Error(`CR ${cr.cr_id} has no Business Partner number (reference_object_no) to delete.`);
    }

    const s4 = await connectS4();
    const oBp = await readBusinessPartner(sBp, 'to_Customer,to_Supplier');
    const oRunner = createStepRunner(s4);
    const aWarnings = [];

    if (oBp.IsMarkedForArchiving === true) {
        aWarnings.push(`Business Partner ${sBp} was already marked for deletion.`);
    } else {
        await oRunner.patch('Mark Business Partner for deletion', oBp,
            keyPath('A_BusinessPartner', { BusinessPartner: sBp }), { IsMarkedForArchiving: true });
    }

    const oCustomer = oBp.to_Customer;
    if (oCustomer && oCustomer.Customer && oCustomer.DeletionIndicator !== true) {
        await oRunner.patch(`Mark customer ${oCustomer.Customer} for deletion`, oCustomer,
            keyPath('A_Customer', { Customer: oCustomer.Customer }), { DeletionIndicator: true });
    }

    const oSupplier = oBp.to_Supplier;
    if (oSupplier && oSupplier.Supplier && oSupplier.DeletionIndicator !== true) {
        await oRunner.patch(`Mark supplier ${oSupplier.Supplier} for deletion`, oSupplier,
            keyPath('A_Supplier', { Supplier: oSupplier.Supplier }), { DeletionIndicator: true });
    }

    console.log(`[s4] CR ${cr.cr_id} — Business Partner ${sBp} marked for deletion in S/4HANA:`, oRunner.done);
    return { bpNumber: sBp, warnings: aWarnings, changes: oRunner.done };
}

module.exports = {
    createBusinessPartner,
    updateBusinessPartner,
    markBusinessPartnerForDeletion,
    readBusinessPartner,
    buildBusinessPartnerPayload,
    extractS4Error,
    FIELD_MAP
};
