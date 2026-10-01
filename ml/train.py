"""
Train the symptom -> department models and export them as JSON for the Node backend.
  python3 ml/train.py           (needs numpy + scikit-learn)

Data is SYNTHETIC: sampled from ml/knowledge.json (department priors and per-symptom probabilities, plus noise).
Accuracy therefore measures how well the models recover that table, not clinical validity. To use real data,
replace `make_dataset` with your labelled records (multi-hot symptom vectors -> department) and re-run.
Two models are exported so the admin can switch between them:
  ml_linear : multinomial logistic regression (ML)
  dl_mlp    : 1-hidden-layer neural network (DL)
"""
import json, pathlib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import train_test_split

ROOT = pathlib.Path(__file__).resolve().parent.parent
symptoms = json.load(open(ROOT / "backend/src/ml/symptoms.json"))
K = json.load(open(ROOT / "ml/knowledge.json"))
F = [s["id"] for s in symptoms]
C = list(K["priors"].keys())
fi = {f: i for i, f in enumerate(F)}
rng = np.random.default_rng(7)

def make_dataset(n=40000):
    pri = np.array([K["priors"][c] for c in C]); pri = pri / pri.sum()
    X = np.zeros((n, len(F)), dtype=np.float32); y = np.zeros(n, dtype=int)
    for r in range(n):
        while True:
            ci = rng.choice(len(C), p=pri)
            x = (rng.random(len(F)) < K["noise"]).astype(np.float32)
            for s, p in K["profiles"][C[ci]].items():
                x[fi[s]] = 1.0 if rng.random() < p else x[fi[s]]
            if x.sum() > 0:
                X[r] = x; y[r] = ci; break
    return X, y

X, y = make_dataset()
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=1, stratify=y)

def metrics(m):
    p = m.predict_proba(Xte)
    top1 = float((p.argmax(1) == yte).mean())
    top2 = float(np.mean([yte[i] in np.argsort(-p[i])[:2] for i in range(len(yte))]))
    return {"top1_accuracy": round(top1, 4), "top2_accuracy": round(top2, 4)}

lin = LogisticRegression(max_iter=2000, C=2.0).fit(Xtr, ytr)
mlp = MLPClassifier(hidden_layer_sizes=(24,), activation="relu", max_iter=400, random_state=1).fit(Xtr, ytr)
assert list(lin.classes_) == list(range(len(C))) and list(mlp.classes_) == list(range(len(C)))

golden_inputs = [["chest_pain"], ["fever"], ["headache", "dizziness"], ["abdominal_pain", "nausea"], ["rash", "itching"], ["knee_pain"], ["shortness_of_breath", "cough"], ["sore_throat", "runny_nose"]]
def vec(ids):
    v = np.zeros((1, len(F)), dtype=np.float32)
    for i in ids: v[0, fi[i]] = 1
    return v
golden = [{"symptoms": g, "linear": [round(float(p), 6) for p in lin.predict_proba(vec(g))[0]],
           "mlp": [round(float(p), 6) for p in mlp.predict_proba(vec(g))[0]]} for g in golden_inputs]

r = lambda a: np.round(np.asarray(a, dtype=float), 6).tolist()
out = {
    "version": "1.0.0", "trained_on": "synthetic (ml/knowledge.json): not clinical data",
    "features": F, "classes": C, "train_samples": int(len(Xtr)), "test_samples": int(len(Xte)),
    "models": {
        "ml_linear": {"type": "logistic_regression", "W": r(lin.coef_), "b": r(lin.intercept_), "metrics": metrics(lin)},
        "dl_mlp": {"type": "mlp_relu_softmax", "W1": r(mlp.coefs_[0]), "b1": r(mlp.intercepts_[0]), "W2": r(mlp.coefs_[1]), "b2": r(mlp.intercepts_[1]),
                   "hidden": 24, "metrics": metrics(mlp)},
    },
    "golden": golden,
}
json.dump(out, open(ROOT / "backend/src/ml/model.json", "w"))
print("linear", out["models"]["ml_linear"]["metrics"], "| mlp", out["models"]["dl_mlp"]["metrics"])
