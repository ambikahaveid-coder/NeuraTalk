import { Shield, FileText, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const currentYear = new Date().getFullYear();

export default function CopyrightPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Copyright & Legal</h1>
          <p className="text-muted-foreground">Intellectual property and legal notices</p>
          <p className="text-xs text-muted-foreground mt-4 italic">Last Updated: February {currentYear}</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <Card className="mb-8">
            <CardContent className="p-8 text-center">
              <p className="text-xl font-semibold text-primary">
                &copy; {currentYear} Mindwhile It Solutions Pvt Ltd. All rights reserved.
              </p>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <Card>
              <CardHeader>
                <Shield className="w-8 h-8 mb-2 text-primary" />
                <CardTitle className="text-lg">Trademarks</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                NeuraTalk, the NeuraTalk logo, and related marks are trademarks of 
                Mindwhile It Solutions Pvt Ltd. Use without permission is prohibited.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <FileText className="w-8 h-8 mb-2 text-primary" />
                <CardTitle className="text-lg">Software</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                All software, algorithms, and technology powering NeuraTalk are 
                proprietary. Reverse engineering is strictly prohibited.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Scale className="w-8 h-8 mb-2 text-primary" />
                <CardTitle className="text-lg">Content</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Website content, documentation, and marketing materials are 
                protected by copyright. Attribution required for any use.
              </CardContent>
            </Card>
          </div>

          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <h2>Intellectual Property Rights</h2>
            <p>
              The NeuraTalk platform, including but not limited to its software, algorithms, 
              user interface designs, graphics, logos, and documentation, are the exclusive 
              property of Mindwhile It Solutions Pvt Ltd and are protected by applicable intellectual 
              property laws of India and international treaties.
            </p>

            <h2>Trademark Notice</h2>
            <p>
              "NeuraTalk" and the NeuraTalk logo are registered trademarks. Other product 
              and company names mentioned herein may be trademarks of their respective owners.
            </p>
            <p>
              You may not use our trademarks without prior written permission, except as 
              expressly permitted by trademark fair use principles.
            </p>

            <h2>Software Rights</h2>
            <p>
              NeuraTalk's voice AI technology, translation engines, signaling protocols, 
              and communication infrastructure are proprietary technologies developed 
              in-house. These technologies represent significant investment in research 
              and development.
            </p>
            <p>
              Unauthorized copying, modification, distribution, or reverse engineering 
              of our software is strictly prohibited and may result in legal action.
            </p>

            <h2>User-Generated Content</h2>
            <p>
              Content you create or transmit using NeuraTalk (such as voice recordings 
              you explicitly save) remains your property. By using our services, you 
              grant us a limited license to process this content solely for providing 
              translation and communication services.
            </p>

            <h2>DMCA and Copyright Complaints</h2>
            <p>
              If you believe any content on NeuraTalk infringes your copyright, please 
              contact our designated agent at:
            </p>
            <ul>
              <li>Email: legal@neuratalk.in</li>
              <li>Subject: "Copyright Complaint"</li>
            </ul>
            <p>
              Please include: description of the copyrighted work, location of the 
              allegedly infringing content, your contact information, and a statement 
              of good faith belief.
            </p>

            <h2>Third-Party Notices</h2>
            <p>
              NeuraTalk may use open-source software components. Applicable open-source 
              licenses and attributions are available upon request.
            </p>

            <h2>Legal Jurisdiction</h2>
            <p>
              These legal notices are governed by the laws of India. Any disputes arising 
              from intellectual property matters shall be subject to the exclusive 
              jurisdiction of courts in Guntur, Andhra Pradesh, India.
            </p>

            <h2>Contact for Legal Matters</h2>
            <p>
              For legal inquiries, trademark permissions, or licensing requests:
            </p>
            <ul>
              <li>Email: legal@neuratalk.in</li>
              <li>Address: Mindwhile It Solutions Pvt Ltd, 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, Andhra Pradesh 522503</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}