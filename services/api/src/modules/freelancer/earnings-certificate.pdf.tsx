import ReactPDFDefault, { renderToBuffer } from "@react-pdf/renderer";
import { fileURLToPath } from "node:url";
import type { EarningsCertificateData } from "./freelancer.service.js";

const { Document, Page, View, Text, Image, StyleSheet } = ReactPDFDefault;

const signatureImagePath = fileURLToPath(
  new URL("../../../assets/signature.png", import.meta.url),
);

const styles = StyleSheet.create({
  page: {
    padding: 34,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#242724",
    lineHeight: 1.35,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottom: "2pt solid #242724",
    paddingBottom: 8,
  },
  brand: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
  },
  brandSub: {
    fontSize: 6.5,
    color: "#737870",
    marginTop: 8,
  },
  headerContact: {
    fontSize: 7.5,
    color: "#737870",
    textAlign: "right",
  },
  section: { marginTop: 11 },
  salutationSection: { marginTop: 22 },
  paymentsSection: { marginTop: 18 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 9.5 },
  muted: { color: "#737870" },
  spaced: { marginTop: 6 },
  table: {
    marginTop: 5,
    border: "1pt solid #cfd4cb",
    borderRadius: 0,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1pt solid #e2e5df",
  },
  tableRowLast: {
    flexDirection: "row",
  },
  tableLabelCell: {
    width: "34%",
    backgroundColor: "#f3f5f1",
    padding: 5,
    fontFamily: "Helvetica-Bold",
  },
  tableValueCell: {
    width: "66%",
    padding: 5,
  },
  paymentsTable: {
    marginTop: 5,
    border: "1pt solid #cfd4cb",
    borderRadius: 0,
    flexDirection: "row",
  },
  paymentsCol: {
    flex: 1,
    borderLeft: "1pt solid #e2e5df",
  },
  paymentsColFirst: {
    flex: 1,
  },
  paymentsHeader: {
    backgroundColor: "#f3f5f1",
    padding: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    textAlign: "center",
  },
  paymentsValue: {
    padding: 5,
    textAlign: "center",
    fontSize: 9.5,
  },
  signatureBlock: { marginTop: 40, alignItems: "flex-end" },
  signatureContainer: { width: 150, alignItems: "center" },
  signatureImage: {
    width: 90,
    height: 30,
    objectFit: "contain",
    marginBottom: 3,
  },
  signatureLine: {
    borderTop: "1pt solid #242724",
    width: 150,
    paddingTop: 3,
  },
  signatureLineName: { fontFamily: "Helvetica-Bold" },
  footer: {
    marginTop: 14,
    borderTop: "1pt solid #e2e5df",
    paddingTop: 8,
  },
  footerTitle: { fontFamily: "Helvetica-Bold", fontSize: 7.5, marginBottom: 3 },
  footerText: { fontSize: 7, color: "#737870", lineHeight: 1.3 },
});

const formatCurrency = (value: number) =>
  `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`;

const formatLongDate = (date: Date) =>
  date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function ProfileRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={last ? styles.tableRowLast : styles.tableRow}>
      <View style={styles.tableLabelCell}>
        <Text>{label}</Text>
      </View>
      <View style={styles.tableValueCell}>
        <Text>{value}</Text>
      </View>
    </View>
  );
}

function EarningsCertificateDocument({
  data,
}: {
  data: EarningsCertificateData;
}) {
  return (
    <Document
      title={`OneMarketplace.io Earnings Certificate - ${data.freelancerName}`}
      author="OneMinute Stack Inc."
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>OneMarketplace.io</Text>
            <Text style={styles.brandSub}>
              A product of OneMinute Stack Inc.
            </Text>
          </View>
          <View style={styles.headerContact}>
            <Text>Tel +1 (555) 000-0000</Text>
            <Text>www.onemarketplace.io</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text>{formatLongDate(data.issuedAt)}</Text>
          <Text style={[styles.muted, styles.spaced]}>
            16192 Coastal Highway,
          </Text>
          <Text style={styles.muted}>Lewes, Delaware 19958, USA</Text>
        </View>

        <View style={styles.salutationSection}>
          <Text>To Whom It May Concern,</Text>
          <Text style={styles.spaced}>
            This letter is to provide documentation of earnings to{" "}
            {data.freelancerName}, who is an independent contractor performing
            services as a freelancer for third-party client companies through
            OneMarketplace.io. OneMarketplace.io provides an online workplace
            where companies hire, manage, and pay freelancers through our
            web-based platform.
          </Text>
          <Text style={styles.spaced}>
            While OneMarketplace.io is not the employer of {data.freelancerName}{" "}
            and does not control their ongoing earnings on the platform, we can
            confirm that {data.freelancerName} has been paid the following
            amounts as an independent contractor.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Freelancer profile</Text>
          <View style={styles.table}>
            <ProfileRow label="Name" value={data.freelancerName} />
            <ProfileRow label="Title" value={data.professionalTitle} />
            <ProfileRow
              label="OneMarketplace.io Profile URL"
              value={data.profileUrl}
            />
            <ProfileRow
              label="Active on OneMarketplace.io Since"
              value={formatLongDate(data.activeSince)}
            />
            <ProfileRow label="Location" value={data.location} last />
          </View>
        </View>

        <View style={styles.paymentsSection}>
          <Text style={styles.sectionTitle}>
            Service contract payments received
          </Text>
          <View style={styles.paymentsTable}>
            {data.windows.map((window, index) => (
              <View
                key={index}
                style={
                  index === 0 ? styles.paymentsColFirst : styles.paymentsCol
                }
              >
                <Text style={styles.paymentsHeader}>{window.label}</Text>
                <Text style={styles.paymentsValue}>
                  {formatCurrency(window.total)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            OneMarketplace.io Certification
          </Text>
          <Text style={styles.spaced}>
            This Statement of Earnings is issued upon the request of the
            above-named freelancer for reference purposes, and OneMarketplace.io
            certifies to the truthfulness and authenticity of the same on the
            basis of company records.
          </Text>
        </View>

        <View style={styles.signatureBlock}>
          <View style={styles.signatureContainer}>
            <Image src={signatureImagePath} style={styles.signatureImage} />
            <View style={styles.signatureLine}>
              <Text style={styles.signatureLineName}>Shahriar Sajeeb</Text>
              <Text style={styles.muted}>Founder & Authorized Signatory,</Text>
              <Text style={styles.muted}>OneMinute Stack Inc.</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>About OneMinute Stack Inc.</Text>
          <Text style={styles.footerText}>
            OneMarketplace.io provides an online workplace where freelancers
            offer virtual services to companies across the globe. The individual
            named above is an independent contractor and not an employee of
            OneMinute Stack Inc. nor the clients to which they provide services.
            The freelancer offers their expertise to the public, using their own
            equipment and assets, and retains the possibility of profit and
            loss. OneMinute Stack Inc. does not control the freelancer&apos;s
            ongoing earnings. This statement confirms work performed by this
            freelancer for their clients through the OneMarketplace.io platform
            and is not a guarantee of future earnings.
          </Text>
          <Text style={[styles.footerText, { marginTop: 8 }]}>
            © {data.issuedAt.getFullYear()} OneMinute Stack Inc. All rights
            reserved.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export const renderEarningsCertificatePdf = async (
  data: EarningsCertificateData,
): Promise<Buffer> =>
  renderToBuffer(<EarningsCertificateDocument data={data} />);
