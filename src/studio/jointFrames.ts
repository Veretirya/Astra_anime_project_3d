import * as C from 'cannon-es'

type ConeOptions = NonNullable<ConstructorParameters<typeof C.ConeTwistConstraint>[2]>

// Independently generated local tangents disagree when the rest pose is not a T-pose.
// Transport one common rest-frame tangent to measure twist without counting swing.
export class RestFrameCone extends C.ConeTwistConstraint {
  private refA: C.Vec3
  private refB: C.Vec3
  private align = new C.Quaternion()
  private wA = new C.Vec3()
  private wB = new C.Vec3()
  constructor(a: C.Body, b: C.Body, options: ConeOptions) {
    super(a, b, options)
    const axis = a.vectorToWorldFrame(this.axisA)
    axis.normalize()
    const tangent = axis.cross(Math.abs(axis.y) < .85 ? C.Vec3.UNIT_Y : C.Vec3.UNIT_X)
    tangent.normalize()
    this.refA = a.vectorToLocalFrame(tangent); this.refB = b.vectorToLocalFrame(tangent)
  }
  update() {
    super.update()
    this.bodyA.vectorToWorldFrame(this.refA, this.wA); this.bodyB.vectorToWorldFrame(this.refB, this.wB)
    this.align.setFromVectors(this.coneEquation.axisA, this.coneEquation.axisB)
    this.align.vmult(this.wA, this.twistEquation.axisA); this.twistEquation.axisB.copy(this.wB)
  }
}