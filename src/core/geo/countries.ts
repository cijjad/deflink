/** ISO 3166-1 alpha-2 codes and English short names. */
const RAW = `AF:Afghanistan|AL:Albania|DZ:Algeria|AD:Andorra|AO:Angola|AG:Antigua and Barbuda|AR:Argentina|AM:Armenia|AU:Australia|AT:Austria|AZ:Azerbaijan|BS:Bahamas|BH:Bahrain|BD:Bangladesh|BB:Barbados|BY:Belarus|BE:Belgium|BZ:Belize|BJ:Benin|BT:Bhutan|BO:Bolivia|BA:Bosnia and Herzegovina|BW:Botswana|BR:Brazil|BN:Brunei|BG:Bulgaria|BF:Burkina Faso|BI:Burundi|CV:Cabo Verde|KH:Cambodia|CM:Cameroon|CA:Canada|CF:Central African Republic|TD:Chad|CL:Chile|CN:China|CO:Colombia|KM:Comoros|CG:Congo|CD:Democratic Republic of the Congo|CR:Costa Rica|CI:Cote d'Ivoire|HR:Croatia|CU:Cuba|CY:Cyprus|CZ:Czechia|DK:Denmark|DJ:Djibouti|DM:Dominica|DO:Dominican Republic|EC:Ecuador|EG:Egypt|SV:El Salvador|GQ:Equatorial Guinea|ER:Eritrea|EE:Estonia|SZ:Eswatini|ET:Ethiopia|FJ:Fiji|FI:Finland|FR:France|GA:Gabon|GM:Gambia|GE:Georgia|DE:Germany|GH:Ghana|GR:Greece|GD:Grenada|GT:Guatemala|GN:Guinea|GW:Guinea-Bissau|GY:Guyana|HT:Haiti|HN:Honduras|HK:Hong Kong|HU:Hungary|IS:Iceland|IN:India|ID:Indonesia|IR:Iran|IQ:Iraq|IE:Ireland|IL:Israel|IT:Italy|JM:Jamaica|JP:Japan|JO:Jordan|KZ:Kazakhstan|KE:Kenya|KI:Kiribati|KP:North Korea|KR:South Korea|KW:Kuwait|KG:Kyrgyzstan|LA:Laos|LV:Latvia|LB:Lebanon|LS:Lesotho|LR:Liberia|LY:Libya|LI:Liechtenstein|LT:Lithuania|LU:Luxembourg|MO:Macao|MG:Madagascar|MW:Malawi|MY:Malaysia|MV:Maldives|ML:Mali|MT:Malta|MH:Marshall Islands|MR:Mauritania|MU:Mauritius|MX:Mexico|FM:Micronesia|MD:Moldova|MC:Monaco|MN:Mongolia|ME:Montenegro|MA:Morocco|MZ:Mozambique|MM:Myanmar|NA:Namibia|NR:Nauru|NP:Nepal|NL:Netherlands|NZ:New Zealand|NI:Nicaragua|NE:Niger|NG:Nigeria|MK:North Macedonia|NO:Norway|OM:Oman|PK:Pakistan|PW:Palau|PS:Palestine|PA:Panama|PG:Papua New Guinea|PY:Paraguay|PE:Peru|PH:Philippines|PL:Poland|PT:Portugal|PR:Puerto Rico|QA:Qatar|RO:Romania|RU:Russia|RW:Rwanda|KN:Saint Kitts and Nevis|LC:Saint Lucia|VC:Saint Vincent and the Grenadines|WS:Samoa|SM:San Marino|ST:Sao Tome and Principe|SA:Saudi Arabia|SN:Senegal|RS:Serbia|SC:Seychelles|SL:Sierra Leone|SG:Singapore|SK:Slovakia|SI:Slovenia|SB:Solomon Islands|SO:Somalia|ZA:South Africa|SS:South Sudan|ES:Spain|LK:Sri Lanka|SD:Sudan|SR:Suriname|SE:Sweden|CH:Switzerland|SY:Syria|TW:Taiwan|TJ:Tajikistan|TZ:Tanzania|TH:Thailand|TL:Timor-Leste|TG:Togo|TO:Tonga|TT:Trinidad and Tobago|TN:Tunisia|TR:Turkiye|TM:Turkmenistan|TV:Tuvalu|UG:Uganda|UA:Ukraine|AE:United Arab Emirates|GB:United Kingdom|US:United States|UY:Uruguay|UZ:Uzbekistan|VU:Vanuatu|VA:Vatican City|VE:Venezuela|VN:Vietnam|YE:Yemen|ZM:Zambia|ZW:Zimbabwe`;

export const COUNTRIES: Record<string, string> = Object.fromEntries(
  RAW.split("|").map((pair) => {
    const [code, name] = pair.split(":");
    return [code, name];
  }),
);

/** Extra names people commonly type. */
const ALIASES: Record<string, string> = {
  uae: "AE",
  emirates: "AE",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  usa: "US",
  "u.s.a.": "US",
  "u.s.": "US",
  america: "US",
  "united states of america": "US",
  ksa: "SA",
  saudi: "SA",
  turkey: "TR",
  "czech republic": "CZ",
  holland: "NL",
  "the netherlands": "NL",
  korea: "KR",
  "ivory coast": "CI",
  burma: "MM",
  "viet nam": "VN",
  "russian federation": "RU",
  swaziland: "SZ",
  "cape verde": "CV",
  drc: "CD",
};

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  return COUNTRIES[code.toUpperCase()] ?? code;
}

/** Lower-cased country name/alias → code; longest names first so "south africa" beats "africa". */
export const COUNTRY_LOOKUP: [string, string][] = [
  ...Object.entries(COUNTRIES).map(([code, name]) => [name.toLowerCase(), code] as [string, string]),
  ...Object.entries(ALIASES),
].sort((a, b) => b[0].length - a[0].length);

/** Major commercial cities (destination parsing). City → ISO country code. */
export const CITIES: Record<string, string> = {
  islamabad: "PK", rawalpindi: "PK", karachi: "PK", lahore: "PK", peshawar: "PK", quetta: "PK", multan: "PK", faisalabad: "PK", sialkot: "PK",
  dubai: "AE", "abu dhabi": "AE", sharjah: "AE", "jebel ali": "AE",
  riyadh: "SA", jeddah: "SA", dammam: "SA", doha: "QA", "kuwait city": "KW", manama: "BH", muscat: "OM",
  london: "GB", manchester: "GB", birmingham: "GB", glasgow: "GB", southampton: "GB",
  hamburg: "DE", berlin: "DE", munich: "DE", frankfurt: "DE", bremen: "DE", stuttgart: "DE",
  paris: "FR", marseille: "FR", toulouse: "FR", rotterdam: "NL", amsterdam: "NL", antwerp: "BE", brussels: "BE",
  milan: "IT", rome: "IT", genoa: "IT", madrid: "ES", barcelona: "ES", valencia: "ES", lisbon: "PT",
  zurich: "CH", geneva: "CH", vienna: "AT", warsaw: "PL", prague: "CZ", stockholm: "SE", oslo: "NO", copenhagen: "DK", helsinki: "FI",
  istanbul: "TR", ankara: "TR", izmir: "TR", athens: "GR", piraeus: "GR",
  "new york": "US", houston: "US", dallas: "US", "los angeles": "US", miami: "US", chicago: "US", seattle: "US", atlanta: "US",
  "san francisco": "US", boston: "US", phoenix: "US", wichita: "US", texas: "US", california: "US", florida: "US",
  toronto: "CA", montreal: "CA", vancouver: "CA", calgary: "CA",
  "mexico city": "MX", "sao paulo": "BR", "rio de janeiro": "BR", "buenos aires": "AR", santiago: "CL", lima: "PE", bogota: "CO",
  singapore: "SG", "kuala lumpur": "MY", jakarta: "ID", bangkok: "TH", manila: "PH", "ho chi minh city": "VN", hanoi: "VN",
  "hong kong": "HK", shanghai: "CN", beijing: "CN", shenzhen: "CN", guangzhou: "CN", tianjin: "CN",
  tokyo: "JP", osaka: "JP", seoul: "KR", busan: "KR", taipei: "TW",
  mumbai: "IN", delhi: "IN", "new delhi": "IN", bangalore: "IN", bengaluru: "IN", chennai: "IN", kolkata: "IN", hyderabad: "IN",
  dhaka: "BD", chittagong: "BD", colombo: "LK", kathmandu: "NP", kabul: "AF", tashkent: "UZ", almaty: "KZ", baku: "AZ",
  cairo: "EG", alexandria: "EG", casablanca: "MA", tunis: "TN", algiers: "DZ", lagos: "NG", abuja: "NG", nairobi: "KE",
  mombasa: "KE", "addis ababa": "ET", "dar es salaam": "TZ", johannesburg: "ZA", "cape town": "ZA", durban: "ZA", accra: "GH",
  amman: "JO", beirut: "LB", baghdad: "IQ", erbil: "IQ", tehran: "IR",
  sydney: "AU", melbourne: "AU", perth: "AU", brisbane: "AU", auckland: "NZ",
};

export const CITY_LOOKUP: [string, string][] = Object.entries(CITIES).sort((a, b) => b[0].length - a[0].length);

/** Sourcing regions (used for "find this in Europe"), mapped to country codes. */
export const REGIONS: Record<string, string[]> = {
  europe: ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "NO", "CH", "IS", "TR", "RS", "UA"],
  "middle east": ["AE", "SA", "QA", "KW", "BH", "OM", "JO", "LB", "IQ", "IL", "IR", "YE", "SY", "PS", "EG"],
  gcc: ["AE", "SA", "QA", "KW", "BH", "OM"],
  "gulf": ["AE", "SA", "QA", "KW", "BH", "OM"],
  "north america": ["US", "CA", "MX"],
  "south america": ["BR", "AR", "CL", "PE", "CO", "VE", "EC", "UY", "PY", "BO"],
  "latin america": ["BR", "AR", "CL", "PE", "CO", "VE", "EC", "UY", "PY", "BO", "MX"],
  asia: ["CN", "JP", "KR", "TW", "HK", "SG", "MY", "ID", "TH", "PH", "VN", "IN", "PK", "BD", "LK"],
  "far east": ["CN", "JP", "KR", "TW", "HK"],
  "south asia": ["IN", "PK", "BD", "LK", "NP"],
  "southeast asia": ["SG", "MY", "ID", "TH", "PH", "VN"],
  africa: ["ZA", "NG", "KE", "EG", "MA", "GH", "ET", "TZ", "DZ", "TN"],
  oceania: ["AU", "NZ"],
};

export function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
