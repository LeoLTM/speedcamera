import { Button } from "@/components/ui/button";
import { useState } from "react";

function App() {
	const [count, setCount] = useState(0);

	return (
		<div className="min-h-screen bg-linear-to-br from-indigo-500 to-purple-600 text-gray-900">
			<div className="container mx-auto px-4 py-10 max-w-3xl">
				<div className="bg-white rounded-xl shadow-xl p-8 mb-8">
					<h2 className="text-2xl font-semibold text-indigo-600 mb-4">
						Interactive Counter
					</h2>
					<p className="mb-4 text-gray-600">
						Click the button below to test React state. With HMR enabled, you
						can edit this component and see changes instantly without losing
						state.
					</p>
					<div className="flex items-center gap-4">
						<Button
							onClick={() => setCount((c) => c + 1)}
							className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-md hover:shadow-lg"
						>
							Count: {count}
						</Button>
						<button
							onClick={() => setCount(0)}
							className="px-4 py-3 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
						>
							Reset
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

export default App;
