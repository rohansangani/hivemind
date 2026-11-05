/**
 * Blitz returns the city exactly as the LinkedIn profile spells it, so a profile set to Hindi comes back
 * as "दिल्ली" instead of "Delhi". This maps the common Indian cities back to English and blanks any other
 * non-Latin value (better empty than unreadable; the country code is kept separately).
 */
const HINDI_CITIES: Record<string, string> = {
  "दिल्ली": "Delhi", "नई दिल्ली": "New Delhi", "साउथ डेल्ही": "South Delhi", "साउथ दिल्ली": "South Delhi", "नॉर्थ दिल्ली": "North Delhi", "पूर्वी दिल्ली": "East Delhi", "पश्चिम दिल्ली": "West Delhi",
  "मुंबई": "Mumbai", "नवी मुंबई": "Navi Mumbai", "ठाणे": "Thane", "पुणे": "Pune", "नागपुर": "Nagpur", "नासिक": "Nashik", "औरंगाबाद": "Aurangabad",
  "बेंगलुरु": "Bengaluru", "बेंगालुरू": "Bengaluru", "बेंगलुरू": "Bengaluru", "गुड़गांव विलेज": "Gurugram", "पुणे सिटी": "Pune", "बेंगलूरु": "Bengaluru", "बैंगलोर": "Bengaluru", "बंगलुरु": "Bengaluru", "मैसूर": "Mysuru", "हैदराबाद": "Hyderabad", "विशाखापत्तनम": "Visakhapatnam",
  "चेन्नई": "Chennai", "एग्मोरे नुंगमबक्कम": "Chennai", "कोयंबटूर": "Coimbatore", "मदुरै": "Madurai", "कोच्चि": "Kochi", "तिरुवनंतपुरम": "Thiruvananthapuram",
  "कोलकाता": "Kolkata", "पटना": "Patna", "रांची": "Ranchi", "भुवनेश्वर": "Bhubaneswar",
  "अहमदाबाद": "Ahmedabad", "सूरत": "Surat", "वडोदरा": "Vadodara", "राजकोट": "Rajkot", "गांधीनगर": "Gandhinagar",
  "जयपुर": "Jaipur", "जोधपुर": "Jodhpur", "उदयपुर": "Udaipur", "कोटा": "Kota",
  "लखनऊ": "Lucknow", "कानपुर": "Kanpur", "आगरा": "Agra", "वाराणसी": "Varanasi", "प्रयागराज": "Prayagraj", "मेरठ": "Meerut",
  "गुरुग्राम": "Gurugram", "गुड़गांव": "Gurugram", "गुरगाँव": "Gurugram", "नोएडा": "Noida", "ग्रेटर नोएडा": "Greater Noida", "गाजियाबाद": "Ghaziabad", "फरीदाबाद": "Faridabad",
  "चंडीगढ़": "Chandigarh", "चंडीगढ": "Chandigarh", "लुधियाना": "Ludhiana", "अमृतसर": "Amritsar", "जालंधर": "Jalandhar", "देहरादून": "Dehradun",
  "इंदौर": "Indore", "भोपाल": "Bhopal", "रायपुर": "Raipur", "गोवा": "Goa", "पणजी": "Panaji",
};

const NON_LATIN = /[^\u0000-ɏḀ-ỿ -⁯]/;

/** English city for a Blitz location, or null when it's in another script we can't map. */
export function cleanCity(city: string | null | undefined): string | null {
  const c = (city || "").trim();
  if (!c) return null;
  if (!NON_LATIN.test(c)) return c;
  return HINDI_CITIES[c] || null;
}
