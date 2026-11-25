// A SQL text expression without Vietnamese tones and in lower case, to compare with words folded the same way in
// JavaScript (audit/record.ts foldText): "Đào Văn Hòa" and "dao van hoa" meet. translate() maps every toned letter of
// either case to its plain lower-case letter; lower() then covers the plain capitals in any database locale. The text is
// expected precomposed (NFC), as names arrive from Microsoft and from Excel.
const GROUPS: Readonly<Record<string, string>> = {
  a: "àảãáạăằẳẵắặâầẩẫấậ", d: "đ", e: "èẻẽéẹêềểễếệ", i: "ìỉĩíị", o: "òỏõóọôồổỗốộơờởỡớợ", u: "ùủũúụưừửữứự", y: "ỳỷỹýỵ",
};
const [FROM, TO] = (() => {
  let from = "", to = "";
  for (const [plain, forms] of Object.entries(GROUPS)) {
    for (const form of forms) { from += form + form.toUpperCase(); to += plain + plain; }
  }
  return [from, to];
})();

/** `expression` folded: no tones, lower case. The letters are constants of this file, never input. */
export const foldSql = (expression: string) => `lower(translate(${expression}, '${FROM}', '${TO}'))`;
