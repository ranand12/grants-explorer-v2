"""
Grant proposal templates — one per major agency.

Each agency wants proposals in a different format, so we generate the right
sections based on who's funding it. If we don't recognize the agency, we
fall back to a generic federal template that works for most.

Supported: NSF (PAPPG), NIH (SF424), DOE (FOA), DARPA (BAA)
"""


def _cover_page(opportunity_title, opportunity_number, agency_name,
                organization_name, project_title, principal_investigator,
                pi_email, requested_amount, project_duration_months):
    return {
        "heading": "Cover Page",
        "content": (
            f"**Opportunity:** {opportunity_title}\n"
            f"**NOFO Number:** {opportunity_number}\n"
            f"**Agency:** {agency_name}\n\n"
            f"**Applicant Organization:** {organization_name or '[Organization Name]'}\n"
            f"**Project Title:** {project_title or '[Project Title]'}\n"
            f"**Principal Investigator:** {principal_investigator or '[PI Name]'}\n"
            f"**PI Email:** {pi_email or '[PI Email]'}\n"
            f"**Requested Amount:** {'${:,.0f}'.format(requested_amount) if requested_amount else '[Amount]'}\n"
            f"**Project Duration:** {project_duration_months} months"
        ),
    }


def _nsf_sections(opportunity_title, opportunity_number, agency_name,
                  organization_name, project_title, principal_investigator,
                  pi_email, project_summary, requested_amount,
                  project_duration_months):
    """NSF proposal format per PAPPG guidelines."""
    return [
        _cover_page(opportunity_title, opportunity_number, agency_name,
                    organization_name, project_title, principal_investigator,
                    pi_email, requested_amount, project_duration_months),
        {
            "heading": "Project Summary (1 page max)",
            "content": (
                "**Overview:**\n"
                f"{project_summary if project_summary else '[Provide a concise overview of the proposed activity suitable for publication. Describe the project objectives and expected significance.]'}\n\n"
                "**Intellectual Merit:**\n"
                "[Describe how the project advances knowledge within its field or across fields. "
                "What is the potential to advance understanding? How well-conceived is the plan? "
                "What qualifications does the team bring?]\n\n"
                "**Broader Impacts:**\n"
                "[Describe the potential to benefit society and contribute to desired societal outcomes. "
                "Consider: STEM education, broadening participation of underrepresented groups, "
                "public engagement, infrastructure for research/education, societal well-being.]"
            ),
        },
        {
            "heading": "Project Description (15 pages max)",
            "content": (
                "**1. Introduction and Background**\n"
                "[Provide context for the proposed work. What gap in knowledge does this address? "
                "How does this build on prior work (yours and others)?]\n\n"
                "**2. Goals and Objectives**\n"
                "- [Objective 1: Specific, measurable research goal]\n"
                "- [Objective 2: Specific, measurable research goal]\n"
                "- [Objective 3: Specific, measurable research goal]\n\n"
                "**3. Research Plan and Methods**\n"
                "[Detail the research design, methods, and analytical framework. "
                "Address feasibility and potential challenges with contingency plans.]\n\n"
                "**4. Broader Impacts Plan**\n"
                "[Describe specific activities for broader impacts: outreach, education, "
                "diversity initiatives, public dissemination, technology transfer.]\n\n"
                "**5. Results from Prior NSF Support**\n"
                "[If PI has received prior NSF funding, summarize results, publications, "
                "and impacts. Include NSF award number, amount, and period.]"
            ),
        },
        {
            "heading": "References Cited",
            "content": (
                "[List all references cited in the Project Description. "
                "Each reference must include all authors, article/book title, "
                "journal/publisher, volume, page numbers, and year. "
                "NSF does not set a limit on references.]"
            ),
        },
        {
            "heading": "Biographical Sketch (3 pages per person)",
            "content": (
                f"**{principal_investigator or '[PI Name]'}**\n\n"
                "**Professional Preparation:**\n"
                "| Institution | Major | Degree | Year |\n"
                "|------------|-------|--------|------|\n"
                "| [University] | [Field] | [B.S./M.S./Ph.D.] | [Year] |\n\n"
                "**Appointments:**\n"
                "- [Current Position, Institution, Start-Present]\n"
                "- [Previous Position, Institution, Start-End]\n\n"
                "**Products (5 most closely related):**\n"
                "1. [Publication/product most relevant to proposed work]\n"
                "2. [Publication/product]\n\n"
                "**Products (5 other significant):**\n"
                "1. [Other significant publication/product]\n\n"
                "**Synergistic Activities (up to 5):**\n"
                "1. [Teaching, mentoring, outreach, or service activity]"
            ),
        },
        {
            "heading": "Budget Justification",
            "content": (
                f"**Total Requested:** {'${:,.0f}'.format(requested_amount) if requested_amount else '[Amount]'}\n\n"
                "| Category | Year 1 | Year 2 | Year 3 | Total | Justification |\n"
                "|----------|--------|--------|--------|-------|---------------|\n"
                "| Senior Personnel (PI) | [Amount] | [Amount] | [Amount] | [Amount] | [X months summer salary] |\n"
                "| Other Personnel (Postdoc) | [Amount] | [Amount] | [Amount] | [Amount] | [Full-time postdoc] |\n"
                "| Graduate Students | [Amount] | [Amount] | [Amount] | [Amount] | [N students, academic year + summer] |\n"
                "| Fringe Benefits | [Amount] | [Amount] | [Amount] | [Amount] | [Rate applied to salaries] |\n"
                "| Equipment (>$5,000) | [Amount] | — | — | [Amount] | [Specific equipment needed] |\n"
                "| Travel | [Amount] | [Amount] | [Amount] | [Amount] | [Conferences, field work] |\n"
                "| Materials & Supplies | [Amount] | [Amount] | [Amount] | [Amount] | [Consumables, software] |\n"
                "| Publication Costs | [Amount] | [Amount] | [Amount] | [Amount] | [Open access fees] |\n"
                "| Indirect Costs (F&A) | [Amount] | [Amount] | [Amount] | [Amount] | [Negotiated rate, MTDC base] |"
            ),
        },
        {
            "heading": "Facilities, Equipment, and Other Resources",
            "content": (
                f"[Describe the resources available at {organization_name or 'the institution'} "
                "that will support the proposed research:\n"
                "- Laboratory space and specialized equipment\n"
                "- Computing resources (HPC clusters, cloud, GPUs)\n"
                "- Library and data resources\n"
                "- Office space for students and postdocs\n"
                "- Shared instrumentation facilities]"
            ),
        },
        {
            "heading": "Data Management Plan (2 pages max)",
            "content": (
                "**Types of Data:**\n"
                "[Describe data types to be generated: experimental, computational, observational.]\n\n"
                "**Data Standards:**\n"
                "[File formats, metadata standards, quality assurance procedures.]\n\n"
                "**Access and Sharing:**\n"
                "[How and when will data be made available? Repository? Embargo period?]\n\n"
                "**Re-Use and Redistribution:**\n"
                "[Licensing, terms of use, citation requirements.]\n\n"
                "**Archiving and Preservation:**\n"
                "[Long-term storage plan, institutional repository, minimum retention period.]"
            ),
        },
    ]


def _nih_sections(opportunity_title, opportunity_number, agency_name,
                  organization_name, project_title, principal_investigator,
                  pi_email, project_summary, requested_amount,
                  project_duration_months):
    """NIH R01/R21 proposal format per SF424 guidelines."""
    return [
        _cover_page(opportunity_title, opportunity_number, agency_name,
                    organization_name, project_title, principal_investigator,
                    pi_email, requested_amount, project_duration_months),
        {
            "heading": "Project Summary / Abstract",
            "content": (
                f"{project_summary if project_summary else '[Provide a succinct description of the project. State the application relevance to public health. Do not exceed 30 lines of text.]'}"
            ),
        },
        {
            "heading": "Project Narrative (2-3 sentences)",
            "content": (
                "[Describe the relevance of this research to public health in plain language. "
                "This narrative will be used by NIH to explain the project to the public.]"
            ),
        },
        {
            "heading": "Specific Aims (1 page)",
            "content": (
                "[Open with a compelling paragraph establishing the problem, "
                "the gap in knowledge, and why it matters for human health.]\n\n"
                "[Second paragraph: describe what you propose and your central hypothesis. "
                "State your long-term goal and the objective of this application.]\n\n"
                "**Aim 1: [Concise statement of first aim]**\n"
                "[Brief description of approach and expected outcome. "
                "State the hypothesis being tested.]\n\n"
                "**Aim 2: [Concise statement of second aim]**\n"
                "[Brief description of approach and expected outcome. "
                "State the hypothesis being tested.]\n\n"
                "**Aim 3: [Concise statement of third aim]**\n"
                "[Brief description of approach and expected outcome.]\n\n"
                "**Impact:** [Summarize the expected outcome and its positive impact on the field.]"
            ),
        },
        {
            "heading": "Research Strategy (12 pages for R01, 6 pages for R21)",
            "content": (
                "**A. Significance**\n"
                "[Explain the importance of the problem. Describe the scientific premise "
                "and strengths/weaknesses of published research. Explain how the project "
                "will improve scientific knowledge, technical capability, or clinical practice.]\n\n"
                "**B. Innovation**\n"
                "[Explain how the application challenges existing paradigms or develops new "
                "methodologies, technologies, or interventions. Describe any novel concepts, "
                "approaches, or tools to be developed.]\n\n"
                "**C. Approach**\n\n"
                "**C.1 Overview**\n"
                "[Describe the overall strategy, methodology, and analyses.]\n\n"
                "**C.2 Preliminary Studies / Progress Report**\n"
                "[Present preliminary data that supports the feasibility and approach. "
                "For renewals, summarize progress during the previous funding period.]\n\n"
                "**C.3 Aim 1: [Title]**\n"
                "- **Rationale:** [Why this aim?]\n"
                "- **Experimental Design:** [Methods, controls, analyses]\n"
                "- **Expected Outcomes:** [What you expect to find]\n"
                "- **Potential Problems & Alternative Strategies:** [Contingency plans]\n\n"
                "**C.4 Aim 2: [Title]**\n"
                "- **Rationale:** [Why this aim?]\n"
                "- **Experimental Design:** [Methods, controls, analyses]\n"
                "- **Expected Outcomes:** [What you expect to find]\n"
                "- **Potential Problems & Alternative Strategies:** [Contingency plans]\n\n"
                "**C.5 Timeline**\n"
                f"| Activity | {'|'.join(f' Y{y} ' for y in range(1, (project_duration_months // 12) + 2))} |\n"
                f"|----------|{'|'.join('---' for _ in range(1, (project_duration_months // 12) + 2))}|\n"
                f"| Aim 1 tasks | {'|'.join('[X]' for _ in range(1, (project_duration_months // 12) + 2))} |\n"
                f"| Aim 2 tasks | {'|'.join('[X]' for _ in range(1, (project_duration_months // 12) + 2))} |"
            ),
        },
        {
            "heading": "Bibliography & References Cited",
            "content": (
                "[List all references cited in the Research Strategy. "
                "Use standard citation format (PMID numbers recommended). "
                "There is no page limit for references.]"
            ),
        },
        {
            "heading": "Budget & Budget Justification",
            "content": (
                f"**Total Requested:** {'${:,.0f}'.format(requested_amount) if requested_amount else '[Amount]'}\n"
                f"**Duration:** {project_duration_months} months "
                f"({project_duration_months // 12} year{'s' if project_duration_months > 12 else ''})\n\n"
                "| Category | Annual | Total | Justification |\n"
                "|----------|--------|-------|---------------|\n"
                "| PI (% effort) | [Amount] | [Amount] | [X% effort, calendar months] |\n"
                "| Co-Investigator(s) | [Amount] | [Amount] | [Role and effort] |\n"
                "| Postdoctoral Fellow | [Amount] | [Amount] | [100% effort] |\n"
                "| Graduate Student(s) | [Amount] | [Amount] | [Stipend per NIH guidelines] |\n"
                "| Research Technician | [Amount] | [Amount] | [Role and effort] |\n"
                "| Fringe Benefits | [Amount] | [Amount] | [Institutional rate] |\n"
                "| Equipment | [Amount] | [Amount] | [Items >$5,000] |\n"
                "| Supplies | [Amount] | [Amount] | [Reagents, consumables] |\n"
                "| Travel | [Amount] | [Amount] | [Scientific conferences] |\n"
                "| Patient Care Costs | [Amount] | [Amount] | [If applicable] |\n"
                "| Consortium/Sub-award | [Amount] | [Amount] | [If applicable] |\n"
                "| F&A (Indirect) Costs | [Amount] | [Amount] | [Negotiated rate] |\n\n"
                "**Note:** NIH R01 direct cost cap is $500,000/year (modular budgets for <$250K/year)."
            ),
        },
        {
            "heading": "Biographical Sketch (NIH Biosketch Format, 5 pages)",
            "content": (
                f"**{principal_investigator or '[PI Name]'}**\n\n"
                "**A. Personal Statement:**\n"
                "[Describe why you are well-suited for this project. "
                "Include up to 4 peer-reviewed publications that highlight experience.]\n\n"
                "**B. Positions, Scientific Appointments, and Honors:**\n"
                "- [Current Position, Institution, Dates]\n"
                "- [Previous Positions]\n"
                "- [Honors and Awards]\n\n"
                "**C. Contributions to Science (up to 5 contributions):**\n"
                "1. [Major contribution with 1-4 supporting citations]\n\n"
                "**D. Research Support (active and completed):**\n"
                "- [Grant Number, PI, Title, Dates, Annual Direct Costs, Role]"
            ),
        },
        {
            "heading": "Human Subjects & Vertebrate Animals",
            "content": (
                "**Human Subjects:**\n"
                "[If applicable: describe the protection of human subjects, "
                "inclusion of women/minorities/children, data safety monitoring. "
                "If not applicable, state 'No human subjects research is proposed.']\n\n"
                "**Vertebrate Animals:**\n"
                "[If applicable: describe the use of vertebrate animals per PHS Policy. "
                "If not applicable, state 'No vertebrate animals will be used.']"
            ),
        },
        {
            "heading": "Facilities & Other Resources",
            "content": (
                f"[Describe resources at {organization_name or 'the institution'}:\n"
                "- Laboratory space (sq ft, equipment)\n"
                "- Animal facilities (if applicable)\n"
                "- Computer/computing resources\n"
                "- Clinical resources (if applicable)\n"
                "- Office and administrative support\n"
                "- Core facilities and shared resources]"
            ),
        },
    ]


def _doe_sections(opportunity_title, opportunity_number, agency_name,
                  organization_name, project_title, principal_investigator,
                  pi_email, project_summary, requested_amount,
                  project_duration_months):
    """DOE proposal format per FOA standard requirements."""
    return [
        _cover_page(opportunity_title, opportunity_number, agency_name,
                    organization_name, project_title, principal_investigator,
                    pi_email, requested_amount, project_duration_months),
        {
            "heading": "Project Summary / Abstract",
            "content": (
                f"{project_summary if project_summary else '[Provide a concise summary of the proposed project including objectives, technical approach, and anticipated impact on DOE mission areas.]'}"
            ),
        },
        {
            "heading": "Technical Volume - Project Narrative",
            "content": (
                "**1. Background and Problem Statement**\n"
                "[Describe the technical problem and its significance to DOE's mission. "
                "Reference the specific FOA topic area and how this project addresses it.]\n\n"
                "**2. Project Objectives**\n"
                "- [Objective 1 aligned with FOA requirements]\n"
                "- [Objective 2]\n"
                "- [Objective 3]\n\n"
                "**3. Technical Approach and Methodology**\n"
                "[Provide detailed description of the scientific/engineering approach. "
                "Include theoretical basis, experimental methods, computational models. "
                "Address technical risks and mitigation strategies.]\n\n"
                "**4. Preliminary Results**\n"
                "[Present any preliminary data or proof-of-concept results that "
                "demonstrate feasibility of the proposed approach.]\n\n"
                "**5. Innovation and Impact**\n"
                "[Explain how the project advances the state-of-the-art. "
                "Describe potential for technology transfer, commercialization, "
                "or advancement of DOE mission goals (clean energy, national security, etc.).]"
            ),
        },
        {
            "heading": "Project Management Plan",
            "content": (
                "**Task Breakdown:**\n\n"
                f"**Total Duration:** {project_duration_months} months\n\n"
                "| Task | Description | Lead | Start | End | Deliverable |\n"
                "|------|------------|------|-------|-----|-------------|\n"
                "| Task 1 | [Description] | [Name] | Month 1 | Month 6 | [Deliverable] |\n"
                "| Task 2 | [Description] | [Name] | Month 4 | Month 12 | [Deliverable] |\n"
                f"| Task 3 | [Description] | [Name] | Month 10 | Month {project_duration_months} | [Deliverable] |\n\n"
                "**Milestones and Decision Points:**\n"
                "- **Go/No-Go Milestone 1 (Month 6):** [Criteria for continuing]\n"
                "- **Go/No-Go Milestone 2 (Month 12):** [Criteria for continuing]\n"
                f"- **Final Milestone (Month {project_duration_months}):** [Project completion criteria]"
            ),
        },
        {
            "heading": "Key Personnel and Institutional Resources",
            "content": (
                f"**Principal Investigator:** {principal_investigator or '[PI Name]'}\n"
                "- **Qualifications:** [Relevant experience and publications]\n"
                "- **Effort:** [% FTE committed to this project]\n\n"
                "**Co-PI / Senior Personnel:**\n"
                "- [Name, Title, Institution, Role, % Effort]\n\n"
                "**Postdoctoral Researchers / Students:**\n"
                "- [Name or TBD, Role]\n\n"
                f"**Institutional Resources at {organization_name or '[Institution]'}:**\n"
                "- [Labs, computing, specialized facilities]"
            ),
        },
        {
            "heading": "Budget Justification",
            "content": (
                f"**Total Requested:** {'${:,.0f}'.format(requested_amount) if requested_amount else '[Amount]'}\n\n"
                "| Category | Year 1 | Year 2 | Year 3 | Total | Justification |\n"
                "|----------|--------|--------|--------|-------|---------------|\n"
                "| Senior Personnel | [Amount] | [Amount] | [Amount] | [Amount] | [PI and Co-PI effort] |\n"
                "| Other Personnel | [Amount] | [Amount] | [Amount] | [Amount] | [Postdocs, students, technicians] |\n"
                "| Fringe Benefits | [Amount] | [Amount] | [Amount] | [Amount] | [Institutional rate] |\n"
                "| Equipment | [Amount] | — | — | [Amount] | [Items >$5,000, DOE approval may be needed] |\n"
                "| Travel | [Amount] | [Amount] | [Amount] | [Amount] | [DOE PI meetings, conferences] |\n"
                "| Materials & Supplies | [Amount] | [Amount] | [Amount] | [Amount] | [Consumables] |\n"
                "| Subcontracts | [Amount] | [Amount] | [Amount] | [Amount] | [If applicable] |\n"
                "| Indirect Costs | [Amount] | [Amount] | [Amount] | [Amount] | [Negotiated rate] |\n\n"
                "**Cost Share:** [DOE often requires 20% non-federal cost share for industry applicants. "
                "State whether cost share is required and how it will be met.]"
            ),
        },
        {
            "heading": "Facilities and Equipment",
            "content": (
                f"[Describe facilities at {organization_name or 'the institution'} "
                "available for this project:\n"
                "- Laboratory space and specialized equipment\n"
                "- Access to DOE national laboratories or user facilities (if applicable)\n"
                "- Computing resources (HPC, cloud)\n"
                "- Fabrication or testing facilities]"
            ),
        },
        {
            "heading": "Data Management Plan",
            "content": (
                "[DOE requires a Data Management Plan per DOE Order 241.1B:\n"
                "- Types of data generated\n"
                "- Data sharing and access policies\n"
                "- Compliance with DOE public access requirements\n"
                "- Repository for long-term preservation\n"
                "- Timeline for data availability after publication]"
            ),
        },
        {
            "heading": "Environmental, Safety, and Health (ES&H)",
            "content": (
                "[If applicable, describe any environmental, safety, or health "
                "considerations associated with the proposed work:\n"
                "- Hazardous materials handling\n"
                "- Radiation safety\n"
                "- Environmental compliance\n"
                "If not applicable, state 'No ES&H concerns are associated with this project.']"
            ),
        },
    ]


def _darpa_sections(opportunity_title, opportunity_number, agency_name,
                    organization_name, project_title, principal_investigator,
                    pi_email, project_summary, requested_amount,
                    project_duration_months):
    """DARPA proposal format per BAA standard requirements."""
    return [
        _cover_page(opportunity_title, opportunity_number, agency_name,
                    organization_name, project_title, principal_investigator,
                    pi_email, requested_amount, project_duration_months),
        {
            "heading": "Executive Summary",
            "content": (
                f"{project_summary if project_summary else '[Provide a concise technical and cost summary. Identify the technical challenges, proposed approach, and potential military/defense applications.]'}"
            ),
        },
        {
            "heading": "Technical Approach",
            "content": (
                "**1. Problem Statement**\n"
                "[Define the technical challenge as described in the BAA. "
                "Identify the specific Technical Area (TA) being addressed.]\n\n"
                "**2. Proposed Innovation**\n"
                "[Describe your novel technical approach. What makes it fundamentally different "
                "from existing solutions? What is the key technical insight?]\n\n"
                "**3. Technical Plan**\n"
                "[Detailed description of the technical approach:\n"
                "- Algorithms, architectures, or system designs\n"
                "- Mathematical/theoretical foundations\n"
                "- Experimental methodology\n"
                "- Integration and testing approach]\n\n"
                "**4. Preliminary Results**\n"
                "[Present any proof-of-concept results, simulations, or prototypes "
                "that demonstrate feasibility of the approach.]\n\n"
                "**5. Risk Mitigation**\n"
                "[Identify top 3-5 technical risks and mitigation strategies:\n"
                "- Risk 1: [Description] / Mitigation: [Strategy]\n"
                "- Risk 2: [Description] / Mitigation: [Strategy]\n"
                "- Risk 3: [Description] / Mitigation: [Strategy]]"
            ),
        },
        {
            "heading": "Statement of Work (SOW)",
            "content": (
                f"**Period of Performance:** {project_duration_months} months\n\n"
                "**Phase 1 (Base Period):**\n"
                "- **Task 1.1:** [Description, deliverables, completion criteria]\n"
                "- **Task 1.2:** [Description, deliverables, completion criteria]\n"
                "- **Milestone 1:** [Quantitative metric for go/no-go decision]\n\n"
                "**Phase 2 (Option Period):**\n"
                "- **Task 2.1:** [Description, deliverables, completion criteria]\n"
                "- **Task 2.2:** [Description, deliverables, completion criteria]\n"
                "- **Milestone 2:** [Quantitative metric for evaluation]\n\n"
                "**Deliverables Summary:**\n"
                "| Deliverable | Type | Due | Description |\n"
                "|------------|------|-----|-------------|\n"
                "| Monthly Status Report | Report | Monthly | Technical progress and financials |\n"
                "| Phase 1 Final Report | Report | Month 12 | Comprehensive technical results |\n"
                "| Software/Hardware | Prototype | [Date] | [Description] |\n"
                f"| Final Report | Report | Month {project_duration_months} | Complete project results |"
            ),
        },
        {
            "heading": "Schedule and Milestones",
            "content": (
                f"**Total Duration:** {project_duration_months} months\n\n"
                "| Milestone | Month | Success Criteria | Metrics |\n"
                "|-----------|-------|-----------------|--------|\n"
                "| Kickoff | 1 | Project initiated | Team assembled |\n"
                "| Design Review | 3 | Architecture finalized | [Quantitative metric] |\n"
                "| Prototype Demo | 9 | Working prototype | [Performance target] |\n"
                "| Phase 1 Complete | 12 | Go/no-go criteria met | [Metric > threshold] |\n"
                f"| Final Demo | {project_duration_months} | All objectives met | [Final metrics] |"
            ),
        },
        {
            "heading": "Key Personnel",
            "content": (
                f"**Principal Investigator:** {principal_investigator or '[PI Name]'}\n"
                f"- **Organization:** {organization_name or '[Organization]'}\n"
                "- **Qualifications:** [Relevant defense/research experience]\n"
                "- **Effort:** [% FTE]\n\n"
                "**Key Team Members:**\n"
                "| Name | Role | Organization | Effort | Expertise |\n"
                "|------|------|-------------|--------|----------|\n"
                "| [Name] | Co-PI | [Org] | [%] | [Area] |\n"
                "| [Name] | Lead Engineer | [Org] | [%] | [Area] |\n"
                "| [Name] | Researcher | [Org] | [%] | [Area] |"
            ),
        },
        {
            "heading": "Budget Summary",
            "content": (
                f"**Total Proposed Cost:** {'${:,.0f}'.format(requested_amount) if requested_amount else '[Amount]'}\n\n"
                "| Category | Phase 1 (Base) | Phase 2 (Option) | Total |\n"
                "|----------|---------------|-----------------|-------|\n"
                "| Direct Labor | [Amount] | [Amount] | [Amount] |\n"
                "| Fringe Benefits | [Amount] | [Amount] | [Amount] |\n"
                "| Travel | [Amount] | [Amount] | [Amount] |\n"
                "| Equipment | [Amount] | [Amount] | [Amount] |\n"
                "| Materials & Supplies | [Amount] | [Amount] | [Amount] |\n"
                "| Subcontracts | [Amount] | [Amount] | [Amount] |\n"
                "| Other Direct Costs | [Amount] | [Amount] | [Amount] |\n"
                "| Indirect Costs | [Amount] | [Amount] | [Amount] |\n"
                "| **Total** | **[Amount]** | **[Amount]** | **[Amount]** |"
            ),
        },
        {
            "heading": "Organizational Capabilities & Facilities",
            "content": (
                f"[Describe {organization_name or 'the organization'}'s capabilities:\n"
                "- Prior DARPA/DoD program experience\n"
                "- Relevant past performance (contract numbers if applicable)\n"
                "- Security clearances held (if applicable)\n"
                "- Specialized facilities and equipment\n"
                "- Teaming arrangements and subcontractor qualifications]"
            ),
        },
    ]


def _generic_sections(opportunity_title, opportunity_number, agency_name,
                      organization_name, project_title, principal_investigator,
                      pi_email, project_summary, requested_amount,
                      project_duration_months):
    """Generic federal grant template for agencies without specific templates."""
    return [
        _cover_page(opportunity_title, opportunity_number, agency_name,
                    organization_name, project_title, principal_investigator,
                    pi_email, requested_amount, project_duration_months),
        {
            "heading": "Project Summary / Abstract",
            "content": project_summary if project_summary else (
                "[Provide a concise summary of the proposed project, including objectives, methods, "
                "and expected outcomes. This section should be no longer than one page.]"
            ),
        },
        {
            "heading": "Statement of Need",
            "content": (
                "[Describe the problem or need that this project addresses. Include relevant statistics, "
                "research findings, and context that demonstrate the urgency and significance of the work. "
                f"Explain how this aligns with {agency_name}'s mission and priorities.]"
            ),
        },
        {
            "heading": "Project Goals and Objectives",
            "content": (
                "**Goal:** [State the overarching goal of the project]\n\n"
                "**Objectives:**\n"
                "1. [Specific, measurable objective 1]\n"
                "2. [Specific, measurable objective 2]\n"
                "3. [Specific, measurable objective 3]\n\n"
                "**Expected Outcomes:**\n"
                "- [Outcome 1]\n"
                "- [Outcome 2]\n"
                "- [Outcome 3]"
            ),
        },
        {
            "heading": "Methodology / Approach",
            "content": (
                "[Describe the methods, activities, and approaches you will use to achieve each objective. "
                "Include:\n"
                "- Research design and methodology\n"
                "- Data collection and analysis plans\n"
                "- Key personnel and their roles\n"
                "- How this approach is innovative or builds on prior work]"
            ),
        },
        {
            "heading": "Project Timeline",
            "content": (
                f"**Total Duration:** {project_duration_months} months\n\n"
                "| Phase | Timeline | Activities | Deliverables |\n"
                "|-------|----------|------------|-------------|\n"
                "| Phase 1: Planning | Months 1-3 | [Activities] | [Deliverables] |\n"
                "| Phase 2: Implementation | Months 4-9 | [Activities] | [Deliverables] |\n"
                f"| Phase 3: Evaluation | Months 10-{project_duration_months} | [Activities] | [Deliverables] |"
            ),
        },
        {
            "heading": "Budget Justification",
            "content": (
                f"**Total Requested:** {'${:,.0f}'.format(requested_amount) if requested_amount else '[Amount]'}\n\n"
                "| Category | Amount | Justification |\n"
                "|----------|--------|---------------|\n"
                "| Personnel (PI, Co-PIs, Staff) | [Amount] | [Justification] |\n"
                "| Equipment | [Amount] | [Justification] |\n"
                "| Travel | [Amount] | [Justification] |\n"
                "| Supplies & Materials | [Amount] | [Justification] |\n"
                "| Other Direct Costs | [Amount] | [Justification] |\n"
                "| Indirect Costs (F&A) | [Amount] | [Rate and base] |"
            ),
        },
        {
            "heading": "Evaluation Plan",
            "content": (
                "[Describe how you will measure progress and success:\n"
                "- Key performance indicators (KPIs)\n"
                "- Data collection methods for evaluation\n"
                "- Reporting schedule\n"
                "- How findings will be used for continuous improvement]"
            ),
        },
        {
            "heading": "Organizational Capacity",
            "content": (
                f"[Describe {organization_name or 'the organization'}'s qualifications, relevant experience, "
                "infrastructure, and capacity to carry out this project. Include:\n"
                "- Relevant prior grants and projects\n"
                "- Facilities and resources available\n"
                "- Key personnel qualifications\n"
                "- Institutional support and commitment]"
            ),
        },
    ]


# Map agency keywords to template functions
_AGENCY_MAP = {
    "nsf": _nsf_sections,
    "national science foundation": _nsf_sections,
    "nih": _nih_sections,
    "national institutes of health": _nih_sections,
    "national institute of health": _nih_sections,
    "doe": _doe_sections,
    "department of energy": _doe_sections,
    "darpa": _darpa_sections,
    "defense advanced research projects agency": _darpa_sections,
}


def get_grant_sections(opportunity_title, opportunity_number, agency_name,
                       organization_name, project_title, principal_investigator,
                       pi_email, project_summary, requested_amount,
                       project_duration_months):
    """Return agency-specific grant sections based on the agency_name.

    Matches agency name (case-insensitive, partial match) to select the
    appropriate template. Falls back to generic template for unknown agencies.
    """
    agency_lower = agency_name.lower().strip()

    # Try exact match first, then substring match
    template_fn = _AGENCY_MAP.get(agency_lower)
    if not template_fn:
        for key, fn in _AGENCY_MAP.items():
            if key in agency_lower or agency_lower in key:
                template_fn = fn
                break

    if not template_fn:
        template_fn = _generic_sections

    return template_fn(
        opportunity_title, opportunity_number, agency_name,
        organization_name, project_title, principal_investigator,
        pi_email, project_summary, requested_amount,
        project_duration_months,
    )
