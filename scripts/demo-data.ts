/**
 * DEMO DATA ONLY — shared by the database seed and the interactive preview.
 * Every organisation, manufacturer, part number, listing and price is fictional.
 */
export type SupplierKind = "OEM" | "MANUFACTURER" | "AUTHORIZED_DISTRIBUTOR" | "STOCKIST" | "DEALER" | "MRO" | "INDUSTRIAL_SUPPLIER" | "LOGISTICS_PROVIDER" | "SOURCING_COMPANY";
export type VerificationLevel = "BUSINESS_VERIFIED" | "SUPPLIER_VERIFIED" | "AUTHORIZED_DISTRIBUTOR" | "COMPLIANCE_VERIFIED";
export type ItemCondition = "NEW" | "NEW_OR_APPROVED_ALTERNATIVE" | "ANY" | "NEW_SURPLUS" | "OVERHAULED" | "SERVICEABLE" | "REPAIRED" | "AS_REMOVED";
export type DataStatus = "VERIFIED" | "SUPPLIER_PROVIDED" | "ESTIMATED" | "HISTORICAL" | "PENDING_VERIFICATION";

export type SupplierSeed = {
  key: string;
  name: string;
  city: string;
  country: string;
  type: SupplierKind;
  region: string;
  categories: string[];
  levels: VerificationLevel[];
  pendingLevel?: VerificationLevel;
};

export const SUPPLIERS: SupplierSeed[] = [
  { key: "alpha", name: "Alpha Demo Industrial Supply LLC", city: "Dubai", country: "AE", type: "STOCKIST", region: "Middle East", categories: ["Hydraulic Pump", "Pump", "Filter", "Bearing", "Valve"], levels: ["BUSINESS_VERIFIED", "SUPPLIER_VERIFIED"] },
  { key: "bravo", name: "Bravo Demo Aero Parts Ltd", city: "London", country: "GB", type: "AUTHORIZED_DISTRIBUTOR", region: "Europe", categories: ["Hydraulic Pump", "Sensor", "Connector", "Seal"], levels: ["BUSINESS_VERIFIED", "SUPPLIER_VERIFIED", "AUTHORIZED_DISTRIBUTOR"] },
  { key: "charlie", name: "Charlie Demo Fluid Power GmbH", city: "Hamburg", country: "DE", type: "INDUSTRIAL_SUPPLIER", region: "Europe", categories: ["Hydraulic Pump", "Pump", "Cylinder", "Hose", "Valve", "Filter"], levels: ["BUSINESS_VERIFIED", "SUPPLIER_VERIFIED"] },
  { key: "delta", name: "Delta Demo Marine Stockists Pte Ltd", city: "Singapore", country: "SG", type: "STOCKIST", region: "Asia", categories: ["Pump", "Seal", "Gasket", "Filter", "Bearing"], levels: ["BUSINESS_VERIFIED"] },
  { key: "echo", name: "Echo Demo Engineering Traders", city: "Karachi", country: "PK", type: "INDUSTRIAL_SUPPLIER", region: "South Asia", categories: ["Bearing", "Filter", "Belt", "Fastener", "Pump"], levels: ["BUSINESS_VERIFIED"] },
  { key: "foxtrot", name: "Foxtrot Demo Bearings Inc", city: "Houston", country: "US", type: "AUTHORIZED_DISTRIBUTOR", region: "North America", categories: ["Bearing", "Gearbox", "Belt", "Motor"], levels: ["BUSINESS_VERIFIED", "SUPPLIER_VERIFIED", "AUTHORIZED_DISTRIBUTOR", "COMPLIANCE_VERIFIED"] },
  { key: "golf", name: "Golf Demo Sourcing Co", city: "Istanbul", country: "TR", type: "SOURCING_COMPANY", region: "Europe", categories: ["Pump", "Filter", "Bearing", "Valve"], levels: [], pendingLevel: "BUSINESS_VERIFIED" },
  { key: "hotel", name: "Hotel Demo MRO Services WLL", city: "Doha", country: "QA", type: "MRO", region: "Middle East", categories: ["Hydraulic Pump", "Sensor", "Actuator", "Valve"], levels: ["BUSINESS_VERIFIED", "SUPPLIER_VERIFIED"] },
];

export const MANUFACTURERS = [
  { key: "xyz", name: "XYZ Demo Industries", country: "US" },
  { key: "kilo", name: "Kilo Demo Motion", country: "DE" },
  { key: "lima", name: "Lima Demo Filtration", country: "GB" },
  { key: "mike", name: "Mike Demo Fluid Power", country: "JP" },
  { key: "november", name: "November Demo Seals", country: "IT" },
  { key: "oscar", name: "Oscar Demo Avionics", country: "FR" },
];

export type ProductSeed = { pn: string; mfr: string; description: string; category: string; specs?: Record<string, string>; controlled?: boolean };

export const PRODUCTS: ProductSeed[] = [
  { pn: "ABC123", mfr: "xyz", description: "Hydraulic Pump, variable displacement", category: "Hydraulic Pump", specs: { Displacement: "28 cc/rev", "Max pressure": "280 bar", Mounting: "SAE B 2-bolt" } },
  { pn: "HP-4521", mfr: "xyz", description: "Hydraulic Pump, fixed displacement", category: "Hydraulic Pump", specs: { Displacement: "45 cc/rev", "Max pressure": "250 bar" } },
  { pn: "HP-4521-A", mfr: "xyz", description: "Hydraulic Pump, fixed displacement (revised)", category: "Hydraulic Pump", specs: { Displacement: "45 cc/rev", "Max pressure": "260 bar" } },
  { pn: "ABC-12345", mfr: "xyz", description: "Hydraulic Pump Assembly with drive coupling", category: "Hydraulic Pump", specs: { Displacement: "28 cc/rev" } },
  { pn: "XYZ-VLV-220", mfr: "xyz", description: "Check Valve, 1/2 inch", category: "Valve" },
  { pn: "XYZ-MTR-5", mfr: "xyz", description: "Electric Motor, 5.5 kW, 3-phase", category: "Motor" },
  { pn: "FLT-200-10", mfr: "lima", description: "Hydraulic Filter Element, 10 micron", category: "Filter", specs: { Rating: "10 µm", Media: "Glass fibre" } },
  { pn: "FLT-300-25", mfr: "lima", description: "Oil Filter, spin-on", category: "Filter" },
  { pn: "LF-AIR-900", mfr: "lima", description: "Air Filter Element, heavy duty", category: "Filter" },
  { pn: "LF-FUEL-45", mfr: "lima", description: "Fuel Filter, water separating", category: "Filter" },
  { pn: "BRG-6205-DMO", mfr: "kilo", description: "Deep Groove Ball Bearing, 25x52x15 mm", category: "Bearing" },
  { pn: "BRG-6308-DMO", mfr: "kilo", description: "Deep Groove Ball Bearing, 40x90x23 mm", category: "Bearing" },
  { pn: "BRG-22210-DMO", mfr: "kilo", description: "Spherical Roller Bearing, 50x90x23 mm", category: "Bearing" },
  { pn: "KM-GBX-40", mfr: "kilo", description: "Helical Gearbox, ratio 40:1", category: "Gearbox" },
  { pn: "KM-BLT-1200", mfr: "kilo", description: "V-Belt, 1200 mm", category: "Belt" },
  { pn: "MFP-CYL-63", mfr: "mike", description: "Hydraulic Cylinder, 63 mm bore", category: "Cylinder" },
  { pn: "MFP-HOSE-12", mfr: "mike", description: "Hydraulic Hose Assembly, 1/2 inch, 2 m", category: "Hose" },
  { pn: "MFP-PMP-77", mfr: "mike", description: "Gear Pump, 28 cc/rev", category: "Pump", specs: { Displacement: "28 cc/rev", "Max pressure": "250 bar", Mounting: "SAE B 2-bolt" } },
  { pn: "MFP-SV-24", mfr: "mike", description: "Solenoid Valve, 24 VDC", category: "Valve" },
  { pn: "NS-ORK-112", mfr: "november", description: "O-Ring Kit, 112 pieces, NBR", category: "Seal" },
  { pn: "NS-GSK-450", mfr: "november", description: "Flange Gasket, 450 mm", category: "Gasket" },
  { pn: "NS-SEAL-75", mfr: "november", description: "Rotary Shaft Seal, 75 mm", category: "Seal" },
  { pn: "OA-SNS-310", mfr: "oscar", description: "Pressure Sensor, 0-310 bar", category: "Sensor" },
  { pn: "OA-CON-28", mfr: "oscar", description: "Circular Connector, 28 pin", category: "Connector" },
  { pn: "CTRL-900", mfr: "oscar", description: "Navigation Module (DEMO controlled item)", category: "Navigation", controlled: true },
];

export type ListingSeed = {
  supplier: string;
  pn: string;
  condition?: ItemCondition;
  qty: number | null;
  price?: [number, number] | number;
  priceStatus?: DataStatus;
  lead: number | null;
  cert?: string;
};

export const LISTINGS: ListingSeed[] = [
  { supplier: "alpha", pn: "ABC123", qty: 12, price: [4500, 5200], priceStatus: "SUPPLIER_PROVIDED", lead: 7, cert: "CoC" },
  { supplier: "bravo", pn: "ABC123", qty: 30, price: 4850, priceStatus: "SUPPLIER_PROVIDED", lead: 5, cert: "OEM certificate" },
  { supplier: "charlie", pn: "ABC123", qty: 0, lead: 21 },
  { supplier: "foxtrot", pn: "ABC123", qty: 8, price: [4400, 5100], priceStatus: "ESTIMATED", lead: 10 },
  { supplier: "delta", pn: "ABC123", qty: null, lead: null },
  { supplier: "hotel", pn: "HP-4521", qty: 4, price: [3900, 4300], priceStatus: "HISTORICAL", lead: 14 },
  { supplier: "alpha", pn: "HP-4521", qty: 2, price: 4100, priceStatus: "SUPPLIER_PROVIDED", lead: 6 },
  { supplier: "charlie", pn: "HP-4521-A", qty: 10, lead: 18 },
  { supplier: "bravo", pn: "ABC-12345", qty: 3, price: 6200, priceStatus: "SUPPLIER_PROVIDED", lead: 9 },
  { supplier: "alpha", pn: "FLT-200-10", qty: 400, price: [38, 45], priceStatus: "SUPPLIER_PROVIDED", lead: 3 },
  { supplier: "echo", pn: "FLT-200-10", qty: 150, price: [41, 49], priceStatus: "ESTIMATED", lead: 5 },
  { supplier: "delta", pn: "FLT-300-25", qty: 220, lead: 4 },
  { supplier: "charlie", pn: "LF-AIR-900", qty: 60, price: 112, priceStatus: "SUPPLIER_PROVIDED", lead: 8 },
  { supplier: "echo", pn: "LF-FUEL-45", qty: 90, lead: 6 },
  { supplier: "foxtrot", pn: "BRG-6205-DMO", qty: 1200, price: [6.5, 8], priceStatus: "SUPPLIER_PROVIDED", lead: 4, cert: "CoC" },
  { supplier: "echo", pn: "BRG-6205-DMO", qty: 300, price: [7, 9.5], priceStatus: "ESTIMATED", lead: 2 },
  { supplier: "foxtrot", pn: "BRG-6308-DMO", qty: 400, lead: 4 },
  { supplier: "delta", pn: "BRG-22210-DMO", qty: 50, lead: 10 },
  { supplier: "foxtrot", pn: "KM-GBX-40", qty: 0, lead: 35 },
  { supplier: "echo", pn: "KM-BLT-1200", qty: 500, price: 14, priceStatus: "SUPPLIER_PROVIDED", lead: 2 },
  { supplier: "charlie", pn: "MFP-CYL-63", qty: 15, lead: 12 },
  { supplier: "charlie", pn: "MFP-HOSE-12", qty: 80, price: 58, priceStatus: "SUPPLIER_PROVIDED", lead: 3 },
  { supplier: "alpha", pn: "MFP-PMP-77", qty: 9, price: [1800, 2100], priceStatus: "SUPPLIER_PROVIDED", lead: 7 },
  { supplier: "hotel", pn: "MFP-SV-24", qty: 25, lead: 6 },
  { supplier: "delta", pn: "NS-ORK-112", qty: 70, lead: 3 },
  { supplier: "bravo", pn: "NS-SEAL-75", qty: 140, price: 22, priceStatus: "SUPPLIER_PROVIDED", lead: 4 },
  { supplier: "delta", pn: "NS-GSK-450", qty: 35, lead: 5 },
  { supplier: "bravo", pn: "OA-SNS-310", qty: 18, price: [640, 720], priceStatus: "SUPPLIER_PROVIDED", lead: 9, cert: "CoC" },
  { supplier: "hotel", pn: "OA-SNS-310", qty: 6, lead: 12 },
  { supplier: "bravo", pn: "OA-CON-28", qty: 220, lead: 5 },
  { supplier: "golf", pn: "ABC123", qty: 5, lead: 15 },
];

export const OEM_RELATIONSHIPS: { supplier: string; mfr: string; rel: SupplierKind; status: DataStatus }[] = [
  { supplier: "bravo", mfr: "xyz", rel: "AUTHORIZED_DISTRIBUTOR", status: "VERIFIED" },
  { supplier: "bravo", mfr: "oscar", rel: "AUTHORIZED_DISTRIBUTOR", status: "VERIFIED" },
  { supplier: "foxtrot", mfr: "kilo", rel: "AUTHORIZED_DISTRIBUTOR", status: "VERIFIED" },
  { supplier: "alpha", mfr: "xyz", rel: "STOCKIST", status: "SUPPLIER_PROVIDED" },
  { supplier: "charlie", mfr: "mike", rel: "DEALER", status: "SUPPLIER_PROVIDED" },
  { supplier: "delta", mfr: "november", rel: "STOCKIST", status: "PENDING_VERIFICATION" },
];


export const CROSS_REFS: { from: string; to: string; type: "SUPERSEDED_BY" | "DOCUMENTED_CROSS_REFERENCE" | "ALTERNATIVE"; evidence: string; status: DataStatus }[] = [
  { from: "HP-4521", to: "HP-4521-A", type: "SUPERSEDED_BY", evidence: "DEMO service bulletin DSB-0001 (fictional)", status: "VERIFIED" },
  { from: "ABC123", to: "ABC-12345", type: "DOCUMENTED_CROSS_REFERENCE", evidence: "DEMO OEM catalogue, page 12 (fictional)", status: "VERIFIED" },
  { from: "ABC123", to: "MFP-PMP-77", type: "ALTERNATIVE", evidence: "Proposed by a DEMO supplier — not technically validated", status: "PENDING_VERIFICATION" },
];
