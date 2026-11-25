# Cover Letter

**Date:** November 25, 2026

**To:** Editor-in-Chief  
*Journal of Chemical Information and Modeling* (JCIM)

**Subject:** Submission of Application Note — *"VortexMD: Serverless Out-of-Core Molecular Dynamics Trajectory Exploration in the Browser"*

Dear Editor,

Please consider our Application Note manuscript entitled **"VortexMD: Serverless Out-of-Core Molecular Dynamics Trajectory Exploration in the Browser"** for publication in the *Journal of Chemical Information and Modeling*.

Browser-based molecular viewers have made 3D structural visualization widely accessible, yet inspecting multi-gigabyte molecular dynamics (MD) trajectories directly in the browser remains constrained by JavaScript heap limits, severe main-thread UI lockups, or the need to maintain dedicated streaming servers. **VortexMD** resolves this bottleneck through a strictly client-side, out-of-core streaming architecture combining header-only `.xtc` binary indexing, IndexedDB offset caching, multi-threaded Web Workers, and an adaptive sliding ring buffer. Across four public biomolecular trajectories spanning 28.39 MB to 5.37 GB, VortexMD keeps peak JS heap usage between 13.44 and 39.41 MB (>210× lower than in-memory browser viewers on a 1.24 GB trajectory), renders Frame 1 in 62–113 ms, sustains interactive frame rates above 30 FPS, and reproduces MDAnalysis v2.11.0 RMSD and 3D interatomic geometry calculations within $5.00 \times 10^{-4}\text{ Å}$ and $7.18 \times 10^{-4}\text{°}$.

In alignment with JCIM's Application Note guidelines and ACS Research Data Policy Level 2:
- **Anonymous Reviewer Access:** VortexMD is live and freely accessible without registration at **https://vortexmd.netlify.app** (with a one-click bundled demo trajectory as well as local file loading).
- **Long-Term Hosting Sustainability:** Because VortexMD is a 100% client-side Progressive Web App (PWA) with zero backend servers or recurring compute costs, static hosting is sustainable indefinitely and any user or institution can redeploy it directly from the open-source repository under the GNU AGPLv3 license (**https://github.com/vortexmd/vortexmd**).
- **Reproducibility & Public Data:** All four benchmark trajectories are hosted in open public repositories (ATLAS and Zenodo DOIs), and executed MDAnalysis validation notebooks plus automated benchmark harnesses are provided in the repository and Supporting Information.

This manuscript is original, has not been published previously, and is not under consideration elsewhere. The author declares no competing financial interest.

Thank you for your time and consideration.

Sincerely,

**Syed Mohammad Lokman**  
AUW Antimicrobial Research Center (AARC)  
Asian University for Women, Chittagong, Bangladesh  
Email: `syed.lokman@auw.edu.bd`
